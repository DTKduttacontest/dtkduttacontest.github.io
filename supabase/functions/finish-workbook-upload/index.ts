import { error, json, optionsResponse, requestJson } from "../_shared/http.ts";
import { cleanFilename, isoStamp, requirePortalUser, requireStaff, SUBJECT_LABELS } from "../_shared/portal.ts";
import { createPdfFile, deleteDriveFile, getDriveRootId, getOrCreateFolderPath, googleAccessToken, readAndValidateStagingPdf, uploadPdfContent, verifyPdfFile } from "../_shared/drive.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return error("Method not allowed.", 405);
  let newlyCreatedDriveFileId: string | null = null;
  let recordedDriveFile = false;
  try {
    const { profile, admin } = await requirePortalUser(request);
    requireStaff(profile);
    const body = await requestJson(request) as Record<string, unknown>;
    const workbookVersionId = String(body.workbook_version_id || "");
    const { data: workbook, error: lookupError } = await admin.from("workbook_versions").select("*").eq("id", workbookVersionId).eq("uploaded_by", profile.id).maybeSingle();
    if (lookupError || !workbook) return error("That workbook upload was not found.", 404);
    if (workbook.is_current || !workbook.staging_path) return error("This workbook upload session is not valid.", 409);

    const bytes = await readAndValidateStagingPdf(admin, workbook.staging_path, workbook.byte_size);
    const token = await googleAccessToken();
    let driveFileId = workbook.drive_file_id as string | null;
    let driveFolderId = workbook.drive_folder_id as string | null;

    if (!driveFileId || !driveFolderId) {
      const workbooksRootId = await getDriveRootId(admin, "google_drive_workbooks_root_id");
      driveFolderId = await getOrCreateFolderPath(token, workbooksRootId, [SUBJECT_LABELS[workbook.subject_slug]]);
      const driveFile = await createPdfFile(token, driveFolderId, `v${workbook.version_number}__${isoStamp()}__${cleanFilename(workbook.original_filename)}`);
      newlyCreatedDriveFileId = driveFile.id;
      await uploadPdfContent(token, driveFile.id, bytes);
      await verifyPdfFile(token, driveFile.id, driveFolderId, workbook.byte_size);
      const { data: recorded, error: recordError } = await admin.from("workbook_versions").update({
        drive_file_id: driveFile.id,
        drive_folder_id: driveFolderId,
      }).eq("id", workbookVersionId).eq("uploaded_by", profile.id).eq("is_current", false).is("drive_file_id", null).select("id").maybeSingle();
      if (recordError || !recorded) throw new Error("This workbook upload was completed by another request. Please refresh the page.");
      recordedDriveFile = true;
      driveFileId = driveFile.id;
    } else {
      await verifyPdfFile(token, driveFileId, driveFolderId, workbook.byte_size);
    }

    const { error: publishError } = await admin.rpc("publish_workbook_version", {
      target_workbook_id: workbookVersionId,
      actor_profile_id: profile.id,
    });
    if (publishError) throw new Error("The new workbook version could not be published.");
    await admin.storage.from("portal-staging").remove([workbook.staging_path]);
    await admin.from("workbook_versions").update({ staging_path: null }).eq("id", workbookVersionId);
    await admin.from("audit_events").insert({ actor_id: profile.id, event_type: "workbook_published", target_id: workbookVersionId, metadata: { subject: workbook.subject_slug, version: workbook.version_number } });
    return json({ published: true });
  } catch (caught) {
    if (newlyCreatedDriveFileId && !recordedDriveFile) {
      try { await deleteDriveFile(await googleAccessToken(), newlyCreatedDriveFileId); } catch { /* best effort cleanup */ }
    }
    return error(caught instanceof Error ? caught.message : "The workbook upload could not be completed.", 400);
  }
});
