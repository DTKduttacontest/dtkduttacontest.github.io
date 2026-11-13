import { error, json, optionsResponse, requestJson } from "../_shared/http.ts";
import { requirePortalUser, requireStudent } from "../_shared/portal.ts";
import { googleAccessToken, verifyPdfFile } from "../_shared/drive.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return error("Method not allowed.", 405);
  try {
    const { profile, admin } = await requirePortalUser(request);
    requireStudent(profile);
    const body = await requestJson(request) as Record<string, unknown>;
    const submissionId = String(body.submission_id || "");
    const driveFileId = String(body.drive_file_id || "");
    const { data: submission, error: lookupError } = await admin.from("submissions").select("*").eq("id", submissionId).eq("student_id", profile.id).maybeSingle();
    if (lookupError || !submission) return error("That submission record was not found.", 404);
    if (submission.status !== "uploading" || submission.drive_file_id !== driveFileId || !submission.drive_folder_id) return error("This upload session is not valid.", 409);
    const token = await googleAccessToken();
    await verifyPdfFile(token, driveFileId, submission.drive_folder_id, submission.byte_size);
    const now = new Date().toISOString();
    const { error: updateError } = await admin.from("submissions").update({ status: "submitted", submitted_at: now }).eq("id", submissionId).eq("status", "uploading");
    if (updateError) throw new Error("The completed submission could not be recorded.");
    await admin.from("audit_events").insert({ actor_id: profile.id, event_type: "submission_completed", target_id: submissionId, metadata: { subject: submission.subject_slug } });
    return json({ submitted_at: now });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "The submission could not be completed.", 400);
  }
});
