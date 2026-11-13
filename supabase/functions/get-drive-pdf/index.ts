import { corsHeaders, error, optionsResponse } from "../_shared/http.ts";
import { requirePortalUser } from "../_shared/portal.ts";
import { googleAccessToken, streamDrivePdf } from "../_shared/drive.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "GET") return error("Method not allowed.", 405);
  try {
    const { profile, admin } = await requirePortalUser(request);
    const url = new URL(request.url);
    const submissionId = url.searchParams.get("submission_id");
    const workbookVersionId = url.searchParams.get("workbook_version_id");
    let driveFileId = "";
    let filename = "workbook.pdf";
    if (submissionId) {
      const { data: submission, error: submissionError } = await admin.from("submissions").select("*").eq("id", submissionId).maybeSingle();
      if (submissionError || !submission) return error("That submission was not found.", 404);
      if (profile.role === "student" && submission.student_id !== profile.id) return error("You may only open your own submitted PDF.", 403);
      if (!["student", "mentor", "admin"].includes(profile.role)) return error("You are not allowed to open this PDF.", 403);
      driveFileId = submission.drive_file_id;
      filename = submission.original_filename || filename;
    } else if (workbookVersionId) {
      const { data: workbook, error: workbookError } = await admin.from("workbook_versions").select("*").eq("id", workbookVersionId).maybeSingle();
      if (workbookError || !workbook) return error("That workbook was not found.", 404);
      if (!['student', 'mentor', 'admin'].includes(profile.role)) return error("You are not allowed to open this workbook.", 403);
      if (profile.role === "student" && !workbook.is_current) return error("Students may only open the current workbook.", 403);
      driveFileId = workbook.drive_file_id;
      filename = workbook.original_filename || filename;
    } else {
      return error("Choose a submission or workbook PDF.");
    }
    const driveResponse = await streamDrivePdf(await googleAccessToken(), driveFileId);
    const headers = new Headers(corsHeaders);
    headers.set("Content-Type", "application/pdf");
    headers.set("Content-Disposition", `inline; filename="${filename.replace(/[\"\\]/g, "_")}"`);
    const length = driveResponse.headers.get("Content-Length");
    if (length) headers.set("Content-Length", length);
    return new Response(driveResponse.body, { status: 200, headers });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "The PDF could not be opened.", 400);
  }
});
