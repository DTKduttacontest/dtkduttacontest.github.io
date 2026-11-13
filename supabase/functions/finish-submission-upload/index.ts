import { error, json, optionsResponse, requestJson } from "../_shared/http.ts";
import { cleanFilename, isoStamp, requirePortalUser, requireStudent, SUBJECT_LABELS } from "../_shared/portal.ts";
import { createPdfFile, deleteDriveFile, getDriveRootId, getOrCreateFolderPath, googleAccessToken, readAndValidateStagingPdf, uploadPdfContent, verifyPdfFile } from "../_shared/drive.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return error("Method not allowed.", 405);
  let newlyCreatedDriveFileId: string | null = null;
  let recordedDriveFile = false;
  try {
    const { profile, admin } = await requirePortalUser(request);
    requireStudent(profile);
    const body = await requestJson(request) as Record<string, unknown>;
    const submissionId = String(body.submission_id || "");
    const { data: submission, error: lookupError } = await admin.from("submissions").select("*").eq("id", submissionId).eq("student_id", profile.id).maybeSingle();
    if (lookupError || !submission) return error("That submission record was not found.", 404);
    if (submission.status !== "uploading" || !submission.staging_path || !profile.school || !profile.class_level || !profile.section || !profile.drive_folder_slug) return error("This upload session is not valid.", 409);

    const bytes = await readAndValidateStagingPdf(admin, submission.staging_path, submission.byte_size);
    const token = await googleAccessToken();
    let driveFileId = submission.drive_file_id as string | null;
    let driveFolderId = submission.drive_folder_id as string | null;

    if (!driveFileId || !driveFolderId) {
      const submissionsRootId = await getDriveRootId(admin, "google_drive_submissions_root_id");
      driveFolderId = await getOrCreateFolderPath(token, submissionsRootId, [
        SUBJECT_LABELS[submission.subject_slug], submission.school, `Class ${submission.class_level}`, submission.section, profile.drive_folder_slug,
      ]);
      const driveName = String(submission.drive_path || `${isoStamp()}__${cleanFilename(submission.original_filename)}`).split("/").pop() || `${isoStamp()}__${cleanFilename(submission.original_filename)}`;
      const driveFile = await createPdfFile(token, driveFolderId, driveName);
      newlyCreatedDriveFileId = driveFile.id;
      await uploadPdfContent(token, driveFile.id, bytes);
      await verifyPdfFile(token, driveFile.id, driveFolderId, submission.byte_size);
      const now = new Date().toISOString();
      const { data: recorded, error: recordError } = await admin.from("submissions").update({
        drive_file_id: driveFile.id,
        drive_folder_id: driveFolderId,
        status: "submitted",
        submitted_at: now,
      }).eq("id", submissionId).eq("student_id", profile.id).eq("status", "uploading").is("drive_file_id", null).select("id").maybeSingle();
      if (recordError || !recorded) throw new Error("This submission was completed by another request. Please refresh the page.");
      recordedDriveFile = true;
      driveFileId = driveFile.id;
    } else {
      await verifyPdfFile(token, driveFileId, driveFolderId, submission.byte_size);
      const now = new Date().toISOString();
      const { data: recorded, error: recordError } = await admin.from("submissions").update({ status: "submitted", submitted_at: now }).eq("id", submissionId).eq("student_id", profile.id).eq("status", "uploading").select("id").maybeSingle();
      if (recordError || !recorded) throw new Error("This submission was completed by another request. Please refresh the page.");
    }

    await admin.storage.from("portal-staging").remove([submission.staging_path]);
    await admin.from("submissions").update({ staging_path: null }).eq("id", submissionId);
    await admin.from("audit_events").insert({ actor_id: profile.id, event_type: "submission_completed", target_id: submissionId, metadata: { subject: submission.subject_slug } });
    return json({ submitted: true, drive_file_id: driveFileId });
  } catch (caught) {
    if (newlyCreatedDriveFileId && !recordedDriveFile) {
      try { await deleteDriveFile(await googleAccessToken(), newlyCreatedDriveFileId); } catch { /* best effort cleanup */ }
    }
    return error(caught instanceof Error ? caught.message : "The submission could not be completed.", 400);
  }
});
