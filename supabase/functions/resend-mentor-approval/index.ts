import { error, json, optionsResponse } from "../_shared/http.ts";
import { randomDigits, requiredEnv, requirePortalUser, sha256 } from "../_shared/portal.ts";
import { sendApprovalCodeEmail } from "../_shared/mail.ts";

/**
 * A pending mentor may request a fresh code only after the old one has expired
 * (or been locked after too many incorrect admin entries). The code is still
 * sent solely to the contest Gmail account, never to the applicant.
 */
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return error("Method not allowed.", 405);
  try {
    const { user, profile, admin } = await requirePortalUser(request);
    if (profile.role !== "mentor_pending") return error("Only a pending mentor account may request an approval code.", 403);
    if (!user.email) return error("The mentor email address could not be verified.", 400);
    const { data: existing, error: lookupError } = await admin
      .from("mentor_approval_requests")
      .select("id, status, expires_at, failed_attempts")
      .eq("applicant_id", profile.id)
      .maybeSingle();
    if (lookupError) throw new Error("The mentor approval request could not be checked.");
    const now = new Date();
    const originalCodeIsActive = existing?.status === "pending"
      && new Date(existing.expires_at).getTime() > now.getTime()
      && existing.failed_attempts < 5;
    if (originalCodeIsActive) {
      return json({ resent: false, message: "The original approval code is still active. Ask the super-admin to use the code already sent to the contest email." });
    }
    const code = randomDigits(8);
    const codeHash = await sha256(`${code}:${requiredEnv("APPROVAL_CODE_PEPPER")}`);
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    const { error: updateError } = await admin.from("mentor_approval_requests").upsert({
      applicant_id: profile.id,
      code_hash: codeHash,
      expires_at: expiresAt,
      failed_attempts: 0,
      status: "pending",
      approved_by: null,
      approved_at: null,
    }, { onConflict: "applicant_id" });
    if (updateError) throw new Error("A fresh mentor approval request could not be created.");
    try {
      await sendApprovalCodeEmail({ applicantName: profile.display_name, applicantEmail: user.email, code });
    } catch (mailError) {
      await admin.from("mentor_approval_requests").update({ status: "expired" }).eq("applicant_id", profile.id).eq("status", "pending");
      throw mailError;
    }
    await admin.from("audit_events").insert({ actor_id: profile.id, event_type: "mentor_approval_code_resent", target_id: profile.id });
    return json({ resent: true, message: "A fresh approval code has been sent to the contest super-admin." });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "The approval code could not be reissued.", 400);
  }
});
