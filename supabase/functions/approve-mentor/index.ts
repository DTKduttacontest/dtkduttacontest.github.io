import { error, json, optionsResponse, requestJson } from "../_shared/http.ts";
import { requireAdmin, requirePortalUser, requiredEnv, sha256 } from "../_shared/portal.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return error("Method not allowed.", 405);
  try {
    const { profile: adminProfile, admin } = await requirePortalUser(request);
    requireAdmin(adminProfile);
    const body = await requestJson(request) as Record<string, unknown>;
    const requestId = String(body.approval_request_id || "");
    const code = String(body.code || "");
    if (!requestId || !/^\d{8}$/.test(code)) return error("Enter the eight-digit approval code.");
    const { data: approval, error: approvalError } = await admin.from("mentor_approval_requests").select("*").eq("id", requestId).maybeSingle();
    if (approvalError || !approval) return error("That mentor approval request was not found.", 404);
    if (approval.status !== "pending" || new Date(approval.expires_at).getTime() < Date.now()) {
      await admin.from("mentor_approval_requests").update({ status: "expired" }).eq("id", requestId).eq("status", "pending");
      return error("This approval code has expired. Ask the applicant to make a new request.", 410);
    }
    if (approval.failed_attempts >= 5) return error("Too many incorrect attempts were made for this request.", 429);
    const expectedHash = await sha256(`${code}:${requiredEnv("APPROVAL_CODE_PEPPER")}`);
    if (expectedHash !== approval.code_hash) {
      await admin.from("mentor_approval_requests").update({ failed_attempts: approval.failed_attempts + 1 }).eq("id", requestId);
      return error("That approval code is not correct.", 403);
    }
    const now = new Date().toISOString();
    const { error: promoteError } = await admin.from("profiles").update({ role: "mentor", approved_at: now }).eq("id", approval.applicant_id).eq("role", "mentor_pending");
    if (promoteError) throw new Error("The mentor account could not be approved.");
    const { error: updateError } = await admin.from("mentor_approval_requests").update({ status: "approved", approved_by: adminProfile.id, approved_at: now }).eq("id", requestId);
    if (updateError) throw new Error("The mentor approval could not be recorded.");
    await admin.from("audit_events").insert({ actor_id: adminProfile.id, event_type: "mentor_approved", target_id: approval.applicant_id });
    return json({ approved: true });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "Mentor approval failed.", 400);
  }
});
