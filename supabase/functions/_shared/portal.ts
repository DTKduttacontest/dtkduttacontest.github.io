import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export const SUBJECTS = new Set([
  "history", "geography", "biology", "physics", "chemistry",
  "computer-science", "english-literature", "hindi-literature",
]);

export const SUBJECT_LABELS: Record<string, string> = {
  history: "History", geography: "Geography", biology: "Biology", physics: "Physics",
  chemistry: "Chemistry", "computer-science": "Computer Science",
  "english-literature": "English Literature", "hindi-literature": "Hindi Literature",
};

export const SCHOOLS = new Set([
  "St. Joseph's Bhagalpur", "Mt. Carmel Bhagalpur", "St. Teresa's Aligunj",
  "St. Teresa's Bypass", "St. Paul's Bhagalpur", "Don Bosco Bhagalpur",
]);
export const SECTIONS = new Set(["A", "B", "C", "D", "E", "F", "G", "H"]);
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

export type PortalRole = "student" | "mentor_pending" | "mentor" | "admin";
export type PortalProfile = {
  id: string;
  display_name: string;
  role: PortalRole;
  school: string | null;
  class_level: number | null;
  section: string | null;
  drive_folder_slug: string | null;
};

export function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Server configuration is missing ${name}.`);
  return value;
}

export function adminClient(): SupabaseClient {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function requirePortalUser(request: Request): Promise<{ user: User; profile: PortalProfile; admin: SupabaseClient }> {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in is required.");
  const userClient = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_ANON_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) throw new Error("Your sign-in session has expired. Please sign in again.");
  const admin = adminClient();
  const { data: profile, error: profileError } = await admin.from("profiles").select("*").eq("id", userData.user.id).maybeSingle();
  if (profileError) throw new Error("Your portal profile could not be checked.");
  if (!profile) throw new Error("Finish creating your portal profile first.");
  return { user: userData.user, profile: profile as PortalProfile, admin };
}

export function requireStaff(profile: PortalProfile) {
  if (!["mentor", "admin"].includes(profile.role)) throw new Error("Mentor access is required.");
}

export function requireAdmin(profile: PortalProfile) {
  if (profile.role !== "admin") throw new Error("Super-admin access is required.");
}

export function requireStudent(profile: PortalProfile) {
  if (profile.role !== "student") throw new Error("Student access is required.");
}

export function cleanFilename(value: unknown) {
  const raw = String(value || "completed-workbook.pdf").replace(/[\\/\x00-\x1f]/g, " ").trim();
  const cleaned = raw.replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/\s+/g, " ").slice(0, 130) || "completed-workbook.pdf";
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

export function validatePdfRequest(body: Record<string, unknown>) {
  const subjectSlug = String(body.subject_slug || "");
  const originalFilename = cleanFilename(body.original_filename);
  const byteSize = Number(body.byte_size);
  const mimeType = String(body.mime_type || "");
  if (!SUBJECTS.has(subjectSlug)) throw new Error("Choose one of the listed subjects.");
  if (!Number.isFinite(byteSize) || byteSize < 1 || byteSize > MAX_PDF_BYTES) throw new Error("The PDF must be between 1 byte and 25 MB.");
  if (mimeType && mimeType !== "application/pdf") throw new Error("Only PDF files may be uploaded.");
  return { subjectSlug, originalFilename, byteSize };
}

export function validateStudentDetails(input: Record<string, unknown>) {
  const displayName = String(input.display_name || "").trim().replace(/\s+/g, " ");
  const school = input.school === null ? null : String(input.school || "");
  const classLevel = input.class_level === null ? null : Number(input.class_level);
  const section = input.section === null ? null : String(input.section || "").toUpperCase();
  const requestedRole = String(input.requested_role || "student");
  if (displayName.length < 2 || displayName.length > 90) throw new Error("Enter a name between 2 and 90 characters.");
  if (!["student", "mentor"].includes(requestedRole)) throw new Error("Choose Student or Mentor.");
  if (requestedRole === "student") {
    if (!school || !SCHOOLS.has(school)) throw new Error("Choose one of the listed schools.");
    if (![8, 9].includes(classLevel || 0)) throw new Error("Choose Class 8 or Class 9.");
    if (!section || !SECTIONS.has(section)) throw new Error("Choose a section from A through H.");
  }
  return { displayName, school: requestedRole === "student" ? school : null, classLevel: requestedRole === "student" ? classLevel : null, section: requestedRole === "student" ? section : null, requestedRole };
}

export function makeFolderSlug(displayName: string, userId: string) {
  const base = displayName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 55) || "student";
  return `${base}--${userId.slice(0, 8)}`;
}

export function isoStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomDigits(length = 8) {
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return [...bytes].map((value) => String(value % 10)).join("");
}
