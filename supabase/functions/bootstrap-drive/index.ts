import { error, json, optionsResponse } from "../_shared/http.ts";
import { getOrCreateFolder, googleAccessToken } from "../_shared/drive.ts";
import { requireAdmin, requirePortalUser } from "../_shared/portal.ts";

/**
 * Creates the two contest roots in the authenticated contest Google Drive.
 * Only the exact super-admin account may run this. Folder IDs never reach a
 * browser client; later uploads read them through the service-side database.
 */
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return error("Method not allowed.", 405);
  try {
    const { profile, admin } = await requirePortalUser(request);
    requireAdmin(profile);
    const token = await googleAccessToken();
    const submissionsRootId = await getOrCreateFolder(token, "root", "DTK Dutta Contest Submissions");
    const workbooksRootId = await getOrCreateFolder(token, "root", "DTK Dutta Contest Workbooks");
    const { error: settingError } = await admin.from("portal_settings").upsert([
      { setting_key: "google_drive_submissions_root_id", setting_value: submissionsRootId, updated_at: new Date().toISOString() },
      { setting_key: "google_drive_workbooks_root_id", setting_value: workbooksRootId, updated_at: new Date().toISOString() },
    ], { onConflict: "setting_key" });
    if (settingError) throw new Error("The Google Drive folders were created but their secure portal settings could not be saved.");
    await admin.from("audit_events").insert({
      actor_id: profile.id,
      event_type: "drive_folders_connected",
      metadata: { submissions_root_id: submissionsRootId, workbooks_root_id: workbooksRootId },
    });
    return json({ ready: true });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "Google Drive could not be connected.", 400);
  }
});
