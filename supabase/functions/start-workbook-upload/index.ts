import { error, json, optionsResponse, requestJson } from "../_shared/http.ts";
import { requirePortalUser, requireStaff, validatePdfRequest } from "../_shared/portal.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return error("Method not allowed.", 405);
  let workbookVersionId: string | null = null;
  let cleanupAdmin: any = null;
  try {
    const { profile, admin } = await requirePortalUser(request);
    cleanupAdmin = admin;
    requireStaff(profile);
    const { subjectSlug, originalFilename, byteSize } = validatePdfRequest(await requestJson(request) as Record<string, unknown>);
    const { data: latest } = await admin.from("workbook_versions").select("version_number").eq("subject_slug", subjectSlug).order("version_number", { ascending: false }).limit(1).maybeSingle();
    const versionNumber = (latest?.version_number || 0) + 1;
    const stagingPath = `${profile.id}/${crypto.randomUUID()}.pdf`;
    const { data: workbook, error: insertError } = await admin.from("workbook_versions").insert({
      subject_slug: subjectSlug,
      version_number: versionNumber,
      original_filename: originalFilename,
      byte_size: byteSize,
      uploaded_by: profile.id,
      is_current: false,
      staging_path: stagingPath,
    }).select("id").single();
    if (insertError || !workbook) throw new Error("The workbook version could not be started.");
    workbookVersionId = workbook.id;
    return json({ workbook_version_id: workbook.id, staging_path: stagingPath });
  } catch (caught) {
    if (workbookVersionId && cleanupAdmin) {
      try { await cleanupAdmin.from("workbook_versions").delete().eq("id", workbookVersionId); } catch { /* best effort */ }
    }
    return error(caught instanceof Error ? caught.message : "The workbook upload could not be started.", 400);
  }
});
