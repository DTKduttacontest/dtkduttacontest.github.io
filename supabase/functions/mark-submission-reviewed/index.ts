import { error, json, optionsResponse, requestJson } from "../_shared/http.ts";
import { requirePortalUser, requireStaff } from "../_shared/portal.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return error("Method not allowed.", 405);
  try {
    const { profile, admin } = await requirePortalUser(request);
    requireStaff(profile);
    const body = await requestJson(request) as Record<string, unknown>;
    const submissionId = String(body.submission_id || "");
    if (!submissionId) return error("Choose a submission first.");
    const { data: updated, error: updateError } = await admin.from("submissions").update({ status: "reviewed" }).eq("id", submissionId).in("status", ["submitted", "needs_revision"]).select("id").maybeSingle();
    if (updateError || !updated) return error("That submission could not be marked reviewed.", 404);
    await admin.from("audit_events").insert({ actor_id: profile.id, event_type: "submission_reviewed", target_id: submissionId });
    return json({ reviewed: true });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "The submission could not be marked reviewed.", 403);
  }
});
