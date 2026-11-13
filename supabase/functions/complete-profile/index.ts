import { error, json, optionsResponse, requestJson } from "../_shared/http.ts";
import { adminClient, makeFolderSlug, randomDigits, requiredEnv, sha256, validateStudentDetails } from "../_shared/portal.ts";
import { sendApprovalCodeEmail } from "../_shared/mail.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return error("Method not allowed.", 405);
  try {
    const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return error("Sign in is required.", 401);
    const userClient = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_ANON_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return error("Your sign-in session has expired. Please sign in again.", 401);
    const user = userData.user;
    if (!user.email || !user.email_confirmed_at) return error("Verify your email address before creating a portal profile.", 403);
    const superAdminEmail = requiredEnv("MENTOR_APPROVER_EMAIL").trim().toLowerCase();
    const normalizedEmail = user.email.trim().toLowerCase();
    const submittedDetails = await requestJson(request) as Record<string, unknown>;
    // The exact contest Gmail becomes the bootstrap administrator regardless of
    // which radio option was selected during its own sign-up.
    const details = validateStudentDetails(normalizedEmail === superAdminEmail
      ? { ...submittedDetails, requested_role: "mentor" }
      : submittedDetails);
    const admin = adminClient();
    const { data: existing, error: existingError } = await admin.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (existingError) throw new Error("The existing profile could not be checked.");
    if (existing) return json({ role: existing.role, account_status: existing.role, profile: existing });

    const role = normalizedEmail === superAdminEmail ? "admin" : details.requestedRole === "mentor" ? "mentor_pending" : "student";
    const profile = {
      id: user.id,
      display_name: details.displayName,
      role,
      school: details.school,
      class_level: details.classLevel,
      section: details.section,
      drive_folder_slug: role === "student" ? makeFolderSlug(details.displayName, user.id) : null,
      approved_at: role === "admin" ? new Date().toISOString() : null,
    };
    const { error: insertError } = await admin.from("profiles").insert(profile);
    if (insertError) throw new Error("The portal profile could not be created.");

    if (role === "mentor_pending") {
      const code = randomDigits(8);
      const codeHash = await sha256(`${code}:${requiredEnv("APPROVAL_CODE_PEPPER")}`);
      const { error: approvalError } = await admin.from("mentor_approval_requests").insert({
        applicant_id: user.id,
        code_hash: codeHash,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });
      if (approvalError) {
        await admin.from("profiles").delete().eq("id", user.id);
        throw new Error("The mentor approval request could not be created.");
      }
      try {
        await sendApprovalCodeEmail({ applicantName: details.displayName, applicantEmail: normalizedEmail, code });
      } catch (mailError) {
        await admin.from("mentor_approval_requests").delete().eq("applicant_id", user.id);
        await admin.from("profiles").delete().eq("id", user.id);
        throw mailError;
      }
    }

    await admin.from("audit_events").insert({ actor_id: user.id, event_type: role === "mentor_pending" ? "mentor_requested" : "profile_created", target_id: user.id });
    return json({ role, account_status: role, profile });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "Profile creation failed.", 400);
  }
});
