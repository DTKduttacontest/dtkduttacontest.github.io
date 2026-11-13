import { error, json, optionsResponse, requestJson } from "../_shared/http.ts";
import { cleanFilename, isoStamp, requirePortalUser, requireStudent, SUBJECT_LABELS, validatePdfRequest } from "../_shared/portal.ts";
import { createPdfFile, createResumableUpload, googleAccessToken, getDriveRootId, getOrCreateFolderPath, deleteDriveFile } from "../_shared/drive.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return error("Method not allowed.", 405);
  let createdDriveFileId: string | null = null;
  let createdSubmissionId: string | null = null;
  let cleanupAdmin: any = null;
  try {
    const { profile, admin } = await requirePortalUser(request);
    cleanupAdmin = admin;
    requireStudent(profile);
    const { subjectSlug, originalFilename, byteSize } = validatePdfRequest(await requestJson(request) as Record<string, unknown>);
    if (!profile.school || !profile.class_level || !profile.section || !profile.drive_folder_slug) throw new Error("Your student profile is incomplete.");
    const { data: workbook, error: workbookError } = await admin.from("workbook_versions").select("id").eq("subject_slug", subjectSlug).eq("is_current", true).maybeSingle();
    if (workbookError || !workbook) throw new Error("A mentor has not uploaded the current workbook for this subject yet.");
    const token = await googleAccessToken();
    const submissionsRootId = await getDriveRootId(admin, "google_drive_submissions_root_id");
    const folderId = await getOrCreateFolderPath(token, submissionsRootId, [
      SUBJECT_LABELS[subjectSlug], profile.school, `Class ${profile.class_level}`, profile.section, profile.drive_folder_slug,
    ]);
    const driveName = `${isoStamp()}__${cleanFilename(originalFilename)}`;
    const driveFile = await createPdfFile(token, folderId, driveName);
    createdDriveFileId = driveFile.id;
    const { data: submission, error: insertError } = await admin.from("submissions").insert({
      student_id: profile.id,
      subject_slug: subjectSlug,
      workbook_version_id: workbook.id,
      drive_file_id: driveFile.id,
      drive_folder_id: folderId,
      drive_path: `${SUBJECT_LABELS[subjectSlug]}/${profile.school}/Class ${profile.class_level}/${profile.section}/${profile.drive_folder_slug}/${driveName}`,
      original_filename: originalFilename,
      byte_size: byteSize,
      status: "uploading",
      student_display_name: profile.display_name,
      school: profile.school,
      class_level: profile.class_level,
      section: profile.section,
    }).select("id").single();
    if (insertError || !submission) throw new Error("The submission record could not be started.");
    createdSubmissionId = submission.id;
    const uploadUrl = await createResumableUpload(token, driveFile.id, byteSize);
    return json({ submission_id: submission.id, upload_url: uploadUrl });
  } catch (caught) {
    if (createdSubmissionId && cleanupAdmin) {
      try { await cleanupAdmin.from("submissions").delete().eq("id", createdSubmissionId); } catch { /* orphan cleanup is best effort */ }
    }
    if (createdDriveFileId) {
      try { await deleteDriveFile(await googleAccessToken(), createdDriveFileId); } catch { /* orphan cleanup is best effort */ }
    }
    return error(caught instanceof Error ? caught.message : "The submission could not be started.", 400);
  }
});
