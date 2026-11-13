import { error, json, optionsResponse } from "../_shared/http.ts";
import { requireAdmin, requirePortalUser } from "../_shared/portal.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return error("Method not allowed.", 405);
  try {
    const { profile, admin } = await requirePortalUser(request);
    requireAdmin(profile);

    await admin
      .from("mentor_approval_requests")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("expires_at", new Date().toISOString());

    const { data, error: queryError } = await admin
      .from("mentor_approval_requests")
      .select("id, applicant_id, status, created_at, expires_at, failed_attempts, profiles!mentor_approval_requests_applicant_id_fkey(display_name)")
      .in("status", ["pending", "expired"])
      .order("created_at", { ascending: true });
    if (queryError) throw new Error("Mentor requests could not be loaded.");

    const requests = await Promise.all((data || []).map(async (item: Record<string, unknown>) => {
      const applicant = item.profiles as { display_name?: string } | null;
      const { data: authData } = await admin.auth.admin.getUserById(String(item.applicant_id));
      return {
        id: item.id,
        status: item.status,
        created_at: item.created_at,
        expires_at: item.expires_at,
        display_name: applicant?.display_name || "Pending mentor",
        email: authData.user?.email || "Email unavailable",
      };
    }));
    return json({ requests });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "Mentor requests could not be loaded.", 403);
  }
});
