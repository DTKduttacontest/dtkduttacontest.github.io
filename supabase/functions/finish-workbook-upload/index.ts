import { error, json, optionsResponse, requestJson } from "../_shared/http.ts";
import { requirePortalUser, requireStaff } from "../_shared/portal.ts";
import { googleAccessToken, verifyPdfFile } from "../_shared/drive.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return error("Method not allowed.", 405);
  try {
    const { profile, admin } = await requirePortalUser(request);
    requireStaff(profile);
    const body = await requestJson(request) as Record<string, unknown>;
    const workbookVersionId = String(body.workbook_version_id || "");
    const driveFileId = String(body.drive_file_id || "");
    const { data: workbook, error: lookupError } = await admin.from("workbook_versions").select("*").eq("id", workbookVersionId).eq("uploaded_by", profile.id).maybeSingle();
    if (lookupError || !workbook) return error("That workbook upload was not found.", 404);
    if (workbook.is_current || workbook.drive_file_id !== driveFileId || !workbook.drive_folder_id) return error("This workbook upload session is not valid.", 409);
    const token = await googleAccessToken();
    await verifyPdfFile(token, driveFileId, workbook.drive_folder_id, workbook.byte_size);
    const { error: publishError } = await admin.rpc("publish_workbook_version", {
      target_workbook_id: workbookVersionId,
      actor_profile_id: profile.id,
    });
    if (publishError) throw new Error("The new workbook version could not be published.");
    await admin.from("audit_events").insert({ actor_id: profile.id, event_type: "workbook_published", target_id: workbookVersionId, metadata: { subject: workbook.subject_slug, version: workbook.version_number } });
    return json({ published: true });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "The workbook upload could not be completed.", 400);
  }
});
