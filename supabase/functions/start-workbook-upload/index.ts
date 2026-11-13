import { error, json, optionsResponse, requestJson } from "../_shared/http.ts";
import { cleanFilename, isoStamp, requirePortalUser, requireStaff, SUBJECT_LABELS, validatePdfRequest } from "../_shared/portal.ts";
import { createPdfFile, createResumableUpload, deleteDriveFile, getDriveRootId, getOrCreateFolderPath, googleAccessToken } from "../_shared/drive.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return error("Method not allowed.", 405);
  let driveFileId: string | null = null;
  let workbookVersionId: string | null = null;
  let cleanupAdmin: any = null;
  try {
    const { profile, admin } = await requirePortalUser(request);
    cleanupAdmin = admin;
    requireStaff(profile);
    const { subjectSlug, originalFilename, byteSize } = validatePdfRequest(await requestJson(request) as Record<string, unknown>);
    const { data: latest } = await admin.from("workbook_versions").select("version_number").eq("subject_slug", subjectSlug).order("version_number", { ascending: false }).limit(1).maybeSingle();
    const versionNumber = (latest?.version_number || 0) + 1;
    const token = await googleAccessToken();
    const workbooksRootId = await getDriveRootId(admin, "google_drive_workbooks_root_id");
    const folderId = await getOrCreateFolderPath(token, workbooksRootId, [SUBJECT_LABELS[subjectSlug]]);
    const driveFile = await createPdfFile(token, folderId, `v${versionNumber}__${isoStamp()}__${cleanFilename(originalFilename)}`);
    driveFileId = driveFile.id;
    const { data: workbook, error: insertError } = await admin.from("workbook_versions").insert({
      subject_slug: subjectSlug,
      version_number: versionNumber,
      drive_file_id: driveFile.id,
      drive_folder_id: folderId,
      original_filename: originalFilename,
      byte_size: byteSize,
      uploaded_by: profile.id,
      is_current: false,
    }).select("id").single();
    if (insertError || !workbook) throw new Error("The workbook version could not be started.");
    workbookVersionId = workbook.id;
    const uploadUrl = await createResumableUpload(token, driveFile.id, byteSize);
    return json({ workbook_version_id: workbook.id, upload_url: uploadUrl });
  } catch (caught) {
    if (workbookVersionId && cleanupAdmin) {
      try { await cleanupAdmin.from("workbook_versions").delete().eq("id", workbookVersionId); } catch { /* best effort */ }
    }
    if (driveFileId) {
      try { await deleteDriveFile(await googleAccessToken(), driveFileId); } catch { /* best effort */ }
    }
    return error(caught instanceof Error ? caught.message : "The workbook upload could not be started.", 400);
  }
});
