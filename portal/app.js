import { PORTAL_CONFIG } from "./portal-config.js";

const SCHOOLS = [
  "St. Joseph's Bhagalpur",
  "Mt. Carmel Bhagalpur",
  "St. Teresa's Aligunj",
  "St. Teresa's Bypass",
  "St. Paul's Bhagalpur",
  "Don Bosco Bhagalpur",
];

const SECTIONS = ["A", "B", "C", "D", "E", "F", "G", "H"];

const SUBJECTS = [
  { slug: "history", label: "History", mark: "H", color: "#8e4b3b", pale: "#f8ebe7" },
  { slug: "geography", label: "Geography", mark: "G", color: "#39756c", pale: "#e8f5f1" },
  { slug: "biology", label: "Biology", mark: "B", color: "#4e7b43", pale: "#edf6e9" },
  { slug: "physics", label: "Physics", mark: "P", color: "#4c5c96", pale: "#eceef8" },
  { slug: "chemistry", label: "Chemistry", mark: "C", color: "#9a5d2d", pale: "#fbefe5" },
  { slug: "computer-science", label: "Computer Science", mark: "CS", color: "#276b98", pale: "#e8f3fa" },
  { slug: "english-literature", label: "English Literature", mark: "E", color: "#7d4d83", pale: "#f5ebf6" },
  { slug: "hindi-literature", label: "Hindi Literature", mark: "हि", color: "#a44755", pale: "#faebed" },
];

const app = document.querySelector("#portal-app");
const configReady = Boolean(PORTAL_CONFIG.supabaseUrl && PORTAL_CONFIG.supabaseAnonKey);
const functionBase = PORTAL_CONFIG.functionsUrl || (PORTAL_CONFIG.supabaseUrl ? `${PORTAL_CONFIG.supabaseUrl.replace(/\/$/, "")}/functions/v1` : "");
let portalAvailable = configReady;
let supabase = null;

const state = {
  authMode: "sign-in",
  session: null,
  user: null,
  profile: null,
  templates: [],
  submissions: [],
  comments: [],
  openSubject: null,
  selectedSubmission: null,
  pendingEmail: "",
  pendingRegistration: null,
  dashboardNotice: null,
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function subjectBySlug(slug) {
  return SUBJECTS.find((subject) => subject.slug === slug);
}

function formatDate(value, includeTime = false) {
  if (!value) return "Not submitted yet";
  const options = includeTime
    ? { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }
    : { day: "numeric", month: "short", year: "numeric" };
  return new Intl.DateTimeFormat("en-IN", options).format(new Date(value));
}

function initials(name) {
  return String(name || "D")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function isStaff(profile = state.profile) {
  return ["mentor", "admin"].includes(profile?.role);
}

function statusPill(status) {
  const label = status === "reviewed" ? "Reviewed" : status === "needs_revision" ? "Needs revision" : status === "submitted" ? "Submitted" : "Uploading";
  const className = status === "reviewed" ? "reviewed" : status === "needs_revision" || status === "uploading" ? "pending" : "";
  return `<span class="portal-pill ${className}">${label}</span>`;
}

function emptyState(title, body) {
  return `<div class="portal-empty-viewer"><div><strong>${escapeHtml(title)}</strong><br><span>${escapeHtml(body)}</span></div></div>`;
}

function schoolOptions(selected = "") {
  return [`<option value="">Choose a school</option>`, ...SCHOOLS.map((school) => `<option value="${escapeHtml(school)}" ${school === selected ? "selected" : ""}>${escapeHtml(school)}</option>`)].join("");
}

function sectionOptions(selected = "") {
  return [`<option value="">Choose section</option>`, ...SECTIONS.map((section) => `<option value="${section}" ${section === selected ? "selected" : ""}>${section}</option>`)].join("");
}

function configNotice() {
  if (portalAvailable) return "";
  if (!configReady) return `<div class="portal-notice portal-warning"><strong>Portal setup in progress.</strong> Account creation and uploads will open after the secure email and Drive services are connected. The public website itself remains unchanged.</div>`;
  return `<div class="portal-notice portal-warning"><strong>The portal could not be loaded.</strong> Check your internet connection and refresh this page. If it continues, contact the contest team.</div>`;
}

function renderLanding(message = "", type = "", registrationDefaults = {}) {
  const signingIn = state.authMode === "sign-in";
  app.innerHTML = `
    <div class="portal-shell portal-landing">
      <section class="portal-landing-intro">
        <p class="portal-eyebrow">A secure learning workspace</p>
        <h1>Learn, submit, and receive thoughtful feedback.</h1>
        <p class="portal-lede">Use one account to open the current workbook for each subject, submit a scanned PDF, and read mentor feedback in the same place.</p>
        <ol class="portal-landing-points">
          <li><span class="portal-point-number">1</span><strong>Make your profile</strong><span>Choose your school, Class 8 or 9, and a fixed section from A–H.</span></li>
          <li><span class="portal-point-number">2</span><strong>Work subject by subject</strong><span>Open the newest workbook PDF and submit only your completed PDF scan.</span></li>
          <li><span class="portal-point-number">3</span><strong>Keep the conversation together</strong><span>Mentors can review submissions and leave feedback under the right piece of work.</span></li>
        </ol>
      </section>
      <section class="portal-card portal-auth-card" aria-labelledby="auth-title">
        <div class="portal-auth-heading">
          <h2 id="auth-title">${signingIn ? "Sign in" : "Create your account"}</h2>
          <p>${signingIn ? "Use the email address and password connected to your profile." : "Students verify their email. Mentor accounts need email verification and contest approval."}</p>
        </div>
        <div class="portal-auth-tabs" role="tablist" aria-label="Account option">
          <button type="button" id="show-sign-in" role="tab" aria-selected="${signingIn}">Sign in</button>
          <button type="button" id="show-sign-up" role="tab" aria-selected="${!signingIn}">Create account</button>
        </div>
        ${configNotice()}
        ${signingIn ? signInForm() : signUpForm(registrationDefaults)}
        ${message ? `<p class="portal-form-message ${type === "error" ? "portal-error" : type === "success" ? "portal-success" : ""}">${escapeHtml(message)}</p>` : ""}
      </section>
    </div>`;

  document.querySelector("#show-sign-in").addEventListener("click", () => {
    state.authMode = "sign-in";
    renderLanding();
  });
  document.querySelector("#show-sign-up").addEventListener("click", () => {
    state.authMode = "sign-up";
    renderLanding();
  });
  if (signingIn) bindSignIn();
  else bindSignUp();
}

function signInForm() {
  return `
    <form id="sign-in-form" class="portal-form" novalidate>
      <div class="portal-form-grid">
        <div class="portal-field portal-span-two"><label for="sign-in-email">Email address <span class="portal-required">*</span></label><input id="sign-in-email" name="email" type="email" autocomplete="email" required /></div>
        <div class="portal-field portal-span-two"><label for="sign-in-password">Password <span class="portal-required">*</span></label><input id="sign-in-password" name="password" type="password" autocomplete="current-password" required /></div>
      </div>
      <div class="portal-button-row"><button class="portal-button" type="submit" ${portalAvailable ? "" : "disabled"}>Sign in</button></div>
      <p class="portal-form-help">If you have not verified your email yet, finish that step before signing in.</p>
    </form>`;
}

function signUpForm(defaults = {}) {
  return `
    <form id="sign-up-form" class="portal-form" novalidate>
      <div class="portal-form-grid">
        <div class="portal-field portal-span-two"><label for="full-name">Student or mentor name <span class="portal-required">*</span></label><input id="full-name" name="displayName" maxlength="90" value="${escapeHtml(defaults.displayName || "")}" autocomplete="name" required /></div>
        <div class="portal-field portal-span-two"><label for="sign-up-email">Email address <span class="portal-required">*</span></label><input id="sign-up-email" name="email" type="email" value="${escapeHtml(defaults.email || "")}" autocomplete="email" required /></div>
        <div class="portal-field"><label for="sign-up-password">Password <span class="portal-required">*</span></label><input id="sign-up-password" name="password" type="password" minlength="10" autocomplete="new-password" required /></div>
        <div class="portal-field" data-student-field><label for="class-level">Class <span class="portal-required">*</span></label><select id="class-level" name="classLevel"><option value="">Choose class</option><option value="8" ${defaults.classLevel === "8" ? "selected" : ""}>Class 8</option><option value="9" ${defaults.classLevel === "9" ? "selected" : ""}>Class 9</option></select></div>
        <div class="portal-field portal-span-two" data-student-field><label for="school">School <span class="portal-required">*</span></label><select id="school" name="school">${schoolOptions(defaults.school)}</select></div>
        <div class="portal-field" data-student-field><label for="section">Section <span class="portal-required">*</span></label><select id="section" name="section">${sectionOptions(defaults.section)}</select></div>
        <div class="portal-field"><label>Account type <span class="portal-required">*</span></label><div class="portal-role-choices"><label class="portal-role-choice"><input type="radio" name="role" value="student" ${defaults.requestedRole !== "mentor" ? "checked" : ""}/><strong>Student</strong><span>Submit your own work and read feedback.</span></label><label class="portal-role-choice"><input type="radio" name="role" value="mentor" ${defaults.requestedRole === "mentor" ? "checked" : ""}/><strong>Mentor</strong><span>Requires your own email verification and contest approval.</span></label></div></div>
      </div>
      <div class="portal-button-row"><button class="portal-button" type="submit" ${portalAvailable ? "" : "disabled"}>Send verification email</button></div>
      <p class="portal-form-help">A mentor applicant does not get access until the contest super-admin approves the request. Student and mentor profile details are used only for this learning portal.</p>
    </form>`;
}

function bindSignIn() {
  document.querySelector("#sign-in-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    if (!email || !password) return renderLanding("Enter both your email address and password.", "error");
    setFormBusy(event.currentTarget, true, "Signing in…");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return renderLanding(humanError(error.message), "error");
    await bootAuthenticated();
  });
}

function bindSignUp() {
  syncRegistrationFields();
  document.querySelectorAll('input[name="role"]').forEach((input) => input.addEventListener("change", syncRegistrationFields));
  document.querySelector("#sign-up-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const registration = {
      displayName: String(form.get("displayName") || "").trim(),
      email: String(form.get("email") || "").trim().toLowerCase(),
      password: String(form.get("password") || ""),
      school: String(form.get("school") || ""),
      classLevel: String(form.get("classLevel") || ""),
      section: String(form.get("section") || ""),
      requestedRole: String(form.get("role") || "student"),
    };
    const validationError = validateRegistration(registration);
    if (validationError) return renderLanding(validationError, "error");
    setFormBusy(event.currentTarget, true, "Sending verification email…");
    const { data, error } = await supabase.auth.signUp({
      email: registration.email,
      password: registration.password,
      options: {
        emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
        data: {
          display_name: registration.displayName,
          school: registration.requestedRole === "student" ? registration.school : null,
          class_level: registration.requestedRole === "student" ? Number(registration.classLevel) : null,
          section: registration.requestedRole === "student" ? registration.section : null,
          requested_role: registration.requestedRole,
        },
      },
    });
    if (error) return renderLanding(humanError(error.message), "error");
    state.pendingEmail = registration.email;
    state.pendingRegistration = registration;
    if (data.session) {
      await completeProfile(registration);
      return;
    }
    renderVerification(registration.email, "Open the verification link in that email. You will return here and your profile will be created automatically.");
  });
}

function validateRegistration(registration) {
  if (registration.displayName.length < 2) return "Enter the full name that should appear on the profile.";
  if (!/^\S+@\S+\.\S+$/.test(registration.email)) return "Enter a valid email address.";
  if (registration.password.length < 10) return "Choose a password with at least 10 characters.";
  if (!["student", "mentor"].includes(registration.requestedRole)) return "Choose Student or Mentor.";
  if (registration.requestedRole === "student") {
    if (!SCHOOLS.includes(registration.school)) return "Choose one of the listed schools.";
    if (!['8', '9'].includes(registration.classLevel)) return "Choose Class 8 or Class 9.";
    if (!SECTIONS.includes(registration.section)) return "Choose a section from A through H.";
  }
  return "";
}

function syncRegistrationFields() {
  const role = document.querySelector('input[name="role"]:checked')?.value || "student";
  document.querySelectorAll("[data-student-field]").forEach((field) => {
    const control = field.querySelector("select");
    const required = role === "student";
    field.classList.toggle("portal-hidden", !required);
    control.disabled = !required;
    control.required = required;
    if (!required) control.value = "";
  });
}

function renderVerification(email, message = "") {
  app.innerHTML = `
    <div class="portal-shell">
      <section class="portal-card" style="max-width: 620px; margin: 3rem auto;">
        <div class="portal-auth-heading"><p class="portal-eyebrow">Verify your email</p><h2>Check your inbox</h2><p>We sent a verification link to <strong>${escapeHtml(email)}</strong>. Open that link in this browser. When you return here, your profile will be created automatically.</p></div>
        <div class="portal-button-row"><button class="portal-text-button" id="back-to-signup" type="button">Back to account details</button></div>
        <p class="portal-form-message">${escapeHtml(message)}</p>
      </section>
    </div>`;
  document.querySelector("#back-to-signup").addEventListener("click", () => {
    state.authMode = "sign-up";
    renderLanding("", "", state.pendingRegistration || {});
  });
}

function profileDataFromMetadata(user) {
  const metadata = user?.user_metadata || {};
  return {
    displayName: metadata.display_name || "",
    email: user?.email || "",
    school: metadata.school || "",
    classLevel: String(metadata.class_level || ""),
    section: metadata.section || "",
    requestedRole: metadata.requested_role || "student",
  };
}

async function completeProfile(registration) {
  const validationError = validateRegistration({ ...registration, password: registration.password || "0123456789" });
  if (validationError) {
    state.authMode = "sign-up";
    renderLanding(validationError, "error", registration);
    return;
  }
  app.innerHTML = `<section class="portal-loading" aria-live="polite"><span class="portal-loading-dot"></span>Creating your profile…</section>`;
  const { data, error } = await invokeFunction("complete-profile", {
    display_name: registration.displayName,
    school: registration.requestedRole === "student" ? registration.school : null,
    class_level: registration.requestedRole === "student" ? Number(registration.classLevel) : null,
    section: registration.requestedRole === "student" ? registration.section : null,
    requested_role: registration.requestedRole,
  });
  if (error) {
    state.authMode = "sign-up";
    renderLanding(humanError(error.message), "error", registration);
    return;
  }
  state.pendingEmail = "";
  state.pendingRegistration = null;
  if (data?.account_status === "mentor_pending") {
    renderPendingMentor();
    return;
  }
  await bootAuthenticated();
}

function renderPendingMentor() {
  app.innerHTML = `
    <div class="portal-shell">
      <section class="portal-card" style="max-width: 700px; margin: 3rem auto; padding: 1.5rem;">
        <p class="portal-eyebrow">Mentor request received</p>
        <h1 style="font-size: clamp(2rem, 4vw, 2.8rem);">Your email is verified. One approval remains.</h1>
        <p class="portal-lede">A single-use approval code has been sent to the DTK Dutta Contest super-admin. Your mentor account will become active only after that code is confirmed inside the portal.</p>
        <div class="portal-notice portal-warning">You do not need to send us your password or forward your own verification code. The approval code is for the contest administrator only.</div>
        <div class="portal-button-row"><button class="portal-button portal-secondary" id="request-fresh-approval" type="button">Request a fresh code</button><button class="portal-button" id="pending-sign-out" type="button">Sign out</button></div>
        <p id="pending-approval-message" class="portal-form-message">Use this only if 15 minutes have passed or the original code was locked after several incorrect entries.</p>
      </section>
    </div>`;
  document.querySelector("#request-fresh-approval").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const message = document.querySelector("#pending-approval-message");
    button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.textContent = "Checking…";
    const result = await invokeFunction("resend-mentor-approval", {});
    setMessage(message, result.error ? humanError(result.error.message) : result.data?.message || "The request was updated.", result.error ? "error" : "success");
    button.textContent = button.dataset.originalText;
    button.disabled = false;
  });
  document.querySelector("#pending-sign-out").addEventListener("click", signOut);
}

async function bootAuthenticated() {
  if (!supabase) return renderLanding("The portal is not connected yet.", "error");
  app.innerHTML = `<section class="portal-loading" aria-live="polite"><span class="portal-loading-dot"></span>Opening your workspace…</section>`;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return renderLanding();
  state.session = session;
  state.user = session.user;
  const { data: profile, error } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  if (error) return renderLanding(humanError(error.message), "error");
  if (!profile) {
    await completeProfile(profileDataFromMetadata(session.user));
    return;
  }
  state.profile = profile;
  if (profile.role === "mentor_pending") return renderPendingMentor();
  await loadDashboard();
}

async function loadDashboard() {
  app.innerHTML = `<section class="portal-loading" aria-live="polite"><span class="portal-loading-dot"></span>Loading your subjects…</section>`;
  const submissionQuery = supabase.from("submissions").select("*").order("submitted_at", { ascending: false });
  if (!isStaff()) submissionQuery.eq("student_id", state.profile.id);
  const [templatesResult, submissionsResult] = await Promise.all([
    supabase.from("workbook_versions").select("*").eq("is_current", true).order("uploaded_at", { ascending: false }),
    submissionQuery,
  ]);
  if (templatesResult.error || submissionsResult.error) {
    return renderErrorPage(humanError(templatesResult.error?.message || submissionsResult.error?.message || "The portal data could not be loaded."));
  }
  state.templates = templatesResult.data || [];
  state.submissions = submissionsResult.data || [];
  state.openSubject = null;
  state.selectedSubmission = null;
  renderDashboard();
}

function renderErrorPage(message) {
  app.innerHTML = `<div class="portal-shell"><div class="portal-notice portal-error"><strong>We could not open the portal.</strong><br>${escapeHtml(message)}</div><button class="portal-button" id="retry-load" type="button">Try again</button></div>`;
  document.querySelector("#retry-load").addEventListener("click", bootAuthenticated);
}

function portalHeader() {
  const roleLabel = state.profile.role === "admin" ? "Super-admin" : state.profile.role === "mentor" ? "Mentor" : "Student";
  const profileLine = state.profile.role === "student"
    ? `${state.profile.school} · Class ${state.profile.class_level} · ${state.profile.section}`
    : `${roleLabel} account`;
  return `
    <header class="portal-header">
      <div><p class="portal-eyebrow">${escapeHtml(roleLabel)} workspace</p><h1>${state.profile.role === "student" ? `Hello, ${escapeHtml(state.profile.display_name.split(" ")[0])}.` : "Workbook portal"}</h1><p class="portal-lede">${state.profile.role === "student" ? "Open a subject to read its workbook, submit a PDF scan, and follow the feedback." : "Review all student submissions, leave feedback, and keep the current workbook library organised."}</p></div>
      <div class="portal-profile-actions"><div class="portal-profile-chip"><span class="portal-profile-initial">${escapeHtml(initials(state.profile.display_name))}</span><span><strong>${escapeHtml(state.profile.display_name)}</strong><span>${escapeHtml(profileLine)}</span></span></div><button id="sign-out" class="portal-button portal-secondary" type="button">Sign out</button></div>
    </header>`;
}

function renderDashboard() {
  const student = state.profile.role === "student";
  const notice = state.dashboardNotice
    ? `<div class="portal-notice ${state.dashboardNotice.type === "error" ? "portal-error" : ""}">${escapeHtml(state.dashboardNotice.message)}</div>`
    : "";
  state.dashboardNotice = null;
  app.innerHTML = `<div class="portal-shell">${portalHeader()}${notice}${student ? studentDashboard() : mentorDashboard()}<p class="portal-footer-note">The portal records the server-side submission time. Student submission PDFs are private to the student and approved mentors.</p></div>`;
  document.querySelector("#sign-out").addEventListener("click", signOut);
  document.querySelectorAll("[data-open-subject]").forEach((button) => button.addEventListener("click", () => openSubject(button.dataset.openSubject)));
  if (!student) {
    document.querySelectorAll("[data-mentor-action]").forEach((button) => button.addEventListener("click", () => handleMentorAction(button.dataset.mentorAction)));
  }
}

function studentDashboard() {
  return `
    <section aria-labelledby="subject-list-title">
      <div class="portal-dashboard-toolbar"><div><h2 id="subject-list-title">My subjects</h2><p class="portal-muted portal-small">Choose a card to open the current workbook and your submission history.</p></div><span class="portal-pill">${plural(state.submissions.length, "submission")}</span></div>
      <div class="portal-subject-grid">${SUBJECTS.map(studentSubjectCard).join("")}</div>
    </section>`;
}

function studentSubjectCard(subject) {
  const template = state.templates.find((item) => item.subject_slug === subject.slug);
  const submissions = state.submissions.filter((item) => item.subject_slug === subject.slug && item.status !== "uploading");
  const latest = submissions[0];
  const status = template ? "Workbook available" : "Workbook not uploaded yet";
  const description = latest ? `Latest submission: ${formatDate(latest.submitted_at)}` : "No completed PDF submitted yet.";
  return `<button type="button" class="portal-subject-card" data-open-subject="${subject.slug}" style="--portal-subject:${subject.color};--portal-subject-pale:${subject.pale};"><span class="portal-subject-icon" aria-hidden="true">${subject.mark}</span><h3>${subject.label}</h3><p>${escapeHtml(description)}</p><div class="portal-card-meta"><strong>${status}</strong><br>${plural(submissions.length, "saved submission")}</div></button>`;
}

function mentorDashboard() {
  const current = state.submissions.filter((submission) => submission.status !== "uploading");
  const reviewed = current.filter((submission) => submission.status === "reviewed").length;
  const currentTemplates = state.templates.length;
  return `
    <section class="portal-admin-grid" aria-label="Portal totals">
      <article class="portal-metric"><strong>${current.length}</strong><span>student submissions</span></article>
      <article class="portal-metric"><strong>${reviewed}</strong><span>marked reviewed</span></article>
      <article class="portal-metric"><strong>${currentTemplates}/8</strong><span>current workbooks uploaded</span></article>
    </section>
    <section aria-labelledby="subject-list-title" style="margin-top: 2rem;">
      <div class="portal-dashboard-toolbar"><div><h2 id="subject-list-title">Subject workspaces</h2><p class="portal-muted portal-small">Open a subject to upload its current workbook or review every student submission.</p></div>${state.profile.role === "admin" ? `<div class="portal-dashboard-controls"><button class="portal-button portal-secondary" type="button" data-mentor-action="drive-setup">Connect Google Drive folders</button><button class="portal-button portal-secondary" type="button" data-mentor-action="approvals">Mentor approvals</button></div>` : ""}</div>
      <div class="portal-subject-grid">${SUBJECTS.map(mentorSubjectCard).join("")}</div>
    </section>`;
}

function mentorSubjectCard(subject) {
  const template = state.templates.find((item) => item.subject_slug === subject.slug);
  const submissions = state.submissions.filter((item) => item.subject_slug === subject.slug && item.status !== "uploading");
  return `<button type="button" class="portal-subject-card" data-open-subject="${subject.slug}" style="--portal-subject:${subject.color};--portal-subject-pale:${subject.pale};"><span class="portal-subject-icon" aria-hidden="true">${subject.mark}</span><h3>${subject.label}</h3><p>${template ? `Current workbook uploaded ${formatDate(template.uploaded_at)}.` : "No workbook PDF is currently available to students."}</p><div class="portal-card-meta"><strong>${plural(submissions.length, "student submission")}</strong><br>${template ? `Version ${template.version_number}` : "Workbook library empty"}</div></button>`;
}

async function openSubject(slug) {
  const subject = subjectBySlug(slug);
  if (!subject) return;
  state.openSubject = subject;
  const subjectSubmissions = state.submissions.filter((submission) => submission.subject_slug === slug && submission.status !== "uploading");
  state.selectedSubmission = subjectSubmissions[0] || null;
  if (state.selectedSubmission) await loadComments(state.selectedSubmission.id);
  else state.comments = [];
  renderSubject();
}

function renderSubject() {
  const subject = state.openSubject;
  const template = state.templates.find((item) => item.subject_slug === subject.slug);
  const isStudent = state.profile.role === "student";
  app.innerHTML = `
    <div class="portal-shell" style="--portal-subject:${subject.color};--portal-subject-pale:${subject.pale};">
      <button class="portal-back-link" id="back-dashboard" type="button">← Back to all subjects</button>
      <section class="portal-subject-heading"><p class="portal-eyebrow">${isStudent ? "Student subject workspace" : "Mentor subject workspace"}</p><h1>${escapeHtml(subject.label)}</h1></section>
      <div class="portal-subject-page" style="margin-top: 1.1rem;">
        <section>
          <article class="portal-panel"><h2>Current workbook</h2><p class="portal-muted portal-small">${template ? `Version ${template.version_number}, uploaded ${formatDate(template.uploaded_at)}.` : "A mentor has not uploaded a workbook for this subject yet."}</p>${workbookViewer(template)}${template ? `<div class="portal-button-row"><button class="portal-button portal-secondary" data-open-workbook="${template.id}" type="button">Open workbook in reader</button></div>` : ""}</article>
          ${isStudent ? studentSubmissionHistory(subject) : mentorSubmissionTable(subject)}
        </section>
        <aside>${isStudent ? studentSubmissionPanel(subject, template) : mentorSubjectPanel(subject, template)}</aside>
      </div>
    </div>`;
  document.querySelector("#back-dashboard").addEventListener("click", loadDashboard);
  document.querySelectorAll("[data-open-workbook]").forEach((button) => button.addEventListener("click", () => openDrivePdf("workbook", button.dataset.openWorkbook)));
  document.querySelectorAll("[data-open-submission]").forEach((button) => button.addEventListener("click", async () => {
    const submission = state.submissions.find((item) => item.id === button.dataset.openSubmission);
    if (!submission) return;
    state.selectedSubmission = submission;
    await loadComments(submission.id);
    renderSubject();
  }));
  document.querySelectorAll("[data-view-submission]").forEach((button) => button.addEventListener("click", () => openDrivePdf("submission", button.dataset.viewSubmission)));
  document.querySelectorAll("[data-review-submission]").forEach((button) => button.addEventListener("click", async () => {
    const submission = state.submissions.find((item) => item.id === button.dataset.reviewSubmission);
    if (!submission) return;
    state.selectedSubmission = submission;
    await loadComments(submission.id);
    renderSubject();
  }));
  bindSubjectActions(subject, template);
}

function workbookViewer(template) {
  if (!template) return emptyState("No workbook yet", "When an approved mentor uploads the current PDF, it will appear here.");
  return emptyState("Workbook ready", "Use “Open workbook in reader” to view this private PDF securely.");
}

function studentSubmissionHistory(subject) {
  const submissions = state.submissions.filter((item) => item.subject_slug === subject.slug && item.status !== "uploading");
  return `<article class="portal-panel" style="margin-top: 1rem;"><h2>My submitted work</h2><p class="portal-muted portal-small">Every successful upload is kept as a dated submission. Select one to read its comments.</p><div class="portal-submission-list">${submissions.length ? submissions.map((submission) => `<button class="portal-submission-item ${state.selectedSubmission?.id === submission.id ? "selected" : ""}" data-open-submission="${submission.id}" type="button"><span><strong>${escapeHtml(submission.original_filename || "Completed workbook.pdf")}</strong><span>Submitted ${formatDate(submission.submitted_at, true)}</span></span>${statusPill(submission.status)}</button>`).join("") : emptyState("No PDF submitted", "Choose a PDF scan in the panel on the right when your workbook is ready.")}</div></article>`;
}

function mentorSubmissionTable(subject) {
  const submissions = state.submissions.filter((item) => item.subject_slug === subject.slug && item.status !== "uploading");
  return `<article class="portal-panel" style="margin-top: 1rem;"><h2>Student submissions</h2><p class="portal-muted portal-small">Every approved mentor can review all submissions. Select a row to read feedback or leave a new comment.</p><div class="portal-table-wrap"><table class="portal-submission-table"><thead><tr><th>Student</th><th>School / class</th><th>Submitted</th><th>Status</th><th>Action</th></tr></thead><tbody>${submissions.length ? submissions.map((submission) => `<tr><td><strong>${escapeHtml(submission.student_display_name)}</strong><br><span class="portal-muted portal-small">${escapeHtml(submission.original_filename || "PDF workbook")}</span></td><td>${escapeHtml(submission.school)}<br><span class="portal-muted portal-small">Class ${escapeHtml(submission.class_level)} · ${escapeHtml(submission.section)}</span></td><td>${formatDate(submission.submitted_at)}</td><td>${statusPill(submission.status)}</td><td><button type="button" class="portal-link-button" data-review-submission="${submission.id}">Review</button></td></tr>`).join("") : `<tr><td colspan="5">No submitted PDFs for this subject yet.</td></tr>`}</tbody></table></div></article>`;
}

function studentSubmissionPanel(subject, template) {
  return `<article class="portal-panel"><h2>Submit completed work</h2>${template ? `<p class="portal-muted portal-small">Upload one completed PDF scan, up to 25 MB. The submission time is recorded by the server.</p><form id="student-upload-form"><div class="portal-upload-drop"><strong>PDF only</strong><br><span class="portal-muted portal-small">Do not upload photos, Word files, or ZIP files.</span><input id="student-pdf" name="pdf" type="file" accept="application/pdf,.pdf" required /><p id="student-file-name" class="portal-file-name">No file selected.</p><div class="portal-progress" id="student-progress" aria-label="Upload progress"><span></span></div></div><div class="portal-button-row"><button class="portal-button" type="submit">Submit PDF</button></div><p id="student-upload-message" class="portal-form-message"></p></form>` : `<div class="portal-notice portal-warning">The submission button will appear after an approved mentor uploads the workbook PDF for this subject.</div>`}</article>${commentPanel()}`;
}

function mentorSubjectPanel(subject, template) {
  return `<article class="portal-panel"><h2>Workbook library</h2><p class="portal-muted portal-small">Upload a new PDF when this subject's student workbook changes. The prior version remains archived; students see the current version.</p><form id="workbook-upload-form"><div class="portal-upload-drop"><strong>Workbook PDF only</strong><input id="workbook-pdf" name="pdf" type="file" accept="application/pdf,.pdf" required /><p id="workbook-file-name" class="portal-file-name">No file selected.</p><div class="portal-progress" id="workbook-progress"><span></span></div></div><div class="portal-button-row"><button class="portal-button" type="submit">${template ? "Upload new version" : "Upload workbook"}</button></div><p id="workbook-upload-message" class="portal-form-message"></p></form></article>${state.selectedSubmission ? mentorReviewPanel(subject) : `<article class="portal-panel"><h2>Feedback</h2><p class="portal-muted">Choose a student submission to view it and leave feedback.</p></article>`}`;
}

function commentPanel() {
  if (!state.selectedSubmission) return `<article class="portal-panel"><h2>Feedback</h2><p class="portal-muted">After you submit a workbook, choose it from “My submitted work” to see the conversation with mentors.</p></article>`;
  return `<article class="portal-panel"><h2>Feedback on this submission</h2><div class="portal-button-row" style="margin-top:0;"><button class="portal-button portal-secondary" type="button" data-view-submission="${state.selectedSubmission.id}">Open my PDF</button></div>${renderComments()}${commentComposer()}</article>`;
}

function mentorReviewPanel() {
  return `<article class="portal-panel"><h2>Review selected submission</h2><p class="portal-muted portal-small"><strong>${escapeHtml(state.selectedSubmission.student_display_name)}</strong><br>${escapeHtml(state.selectedSubmission.school)} · Class ${escapeHtml(state.selectedSubmission.class_level)} · ${escapeHtml(state.selectedSubmission.section)}<br>Submitted ${formatDate(state.selectedSubmission.submitted_at, true)}</p><div class="portal-button-row" style="margin-top:0;"><button class="portal-button portal-secondary" type="button" data-view-submission="${state.selectedSubmission.id}">Open submitted PDF</button><button class="portal-button portal-secondary" data-mark-reviewed="${state.selectedSubmission.id}" type="button">Mark reviewed</button></div>${renderComments()}${commentComposer()}</article>`;
}

function renderComments() {
  if (!state.comments.length) return `<div class="portal-comment-list" style="margin-top:1rem;"><p class="portal-muted portal-small">No comments yet.</p></div>`;
  return `<div class="portal-comment-list" style="margin-top:1rem;">${state.comments.map((comment) => `<article class="portal-comment ${["mentor", "admin"].includes(comment.author_role) ? "is-mentor" : ""}"><div class="portal-comment-head"><strong>${escapeHtml(comment.author_display_name)} ${["mentor", "admin"].includes(comment.author_role) ? "(Mentor)" : ""}</strong><time datetime="${escapeHtml(comment.created_at)}">${formatDate(comment.created_at, true)}</time></div><p>${escapeHtml(comment.body)}</p></article>`).join("")}</div>`;
}

function commentComposer() {
  return `<form id="comment-form" class="portal-comment-form"><div class="portal-field"><label for="comment-body">Add a comment</label><textarea id="comment-body" name="body" maxlength="2000" placeholder="Write a useful question, observation, or response…" required></textarea></div><div class="portal-button-row"><button class="portal-button portal-secondary" type="submit">Post comment</button></div><p id="comment-message" class="portal-form-message"></p></form>`;
}

function bindSubjectActions(subject, template) {
  const fileInput = document.querySelector("#student-pdf");
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      document.querySelector("#student-file-name").textContent = fileInput.files?.[0] ? `${fileInput.files[0].name} (${formatBytes(fileInput.files[0].size)})` : "No file selected.";
    });
    document.querySelector("#student-upload-form").addEventListener("submit", (event) => submitStudentPdf(event, subject));
  }
  const workbookInput = document.querySelector("#workbook-pdf");
  if (workbookInput) {
    workbookInput.addEventListener("change", () => {
      document.querySelector("#workbook-file-name").textContent = workbookInput.files?.[0] ? `${workbookInput.files[0].name} (${formatBytes(workbookInput.files[0].size)})` : "No file selected.";
    });
    document.querySelector("#workbook-upload-form").addEventListener("submit", (event) => submitWorkbookPdf(event, subject));
  }
  document.querySelector("#comment-form")?.addEventListener("submit", postComment);
  document.querySelectorAll("[data-mark-reviewed]").forEach((button) => button.addEventListener("click", () => markReviewed(button.dataset.markReviewed)));
}

async function loadComments(submissionId) {
  const { data, error } = await supabase.from("submission_comments").select("*").eq("submission_id", submissionId).order("created_at", { ascending: true });
  if (error) {
    state.comments = [];
    return;
  }
  state.comments = data || [];
}

async function postComment(event) {
  event.preventDefault();
  if (!state.selectedSubmission) return;
  const form = event.currentTarget;
  const body = String(new FormData(form).get("body") || "").trim();
  const message = document.querySelector("#comment-message");
  if (!body) {
    message.textContent = "Write a comment before posting it.";
    message.className = "portal-form-message portal-error";
    return;
  }
  setFormBusy(form, true, "Posting…");
  const { error } = await supabase.from("submission_comments").insert({ submission_id: state.selectedSubmission.id, body });
  if (error) {
    message.textContent = humanError(error.message);
    message.className = "portal-form-message portal-error";
    setFormBusy(form, false);
    return;
  }
  await loadComments(state.selectedSubmission.id);
  renderSubject();
}

async function markReviewed(submissionId) {
  const { error } = await invokeFunction("mark-submission-reviewed", { submission_id: submissionId });
  if (error) return alert(humanError(error.message));
  const current = state.submissions.find((item) => item.id === submissionId);
  if (current) current.status = "reviewed";
  renderSubject();
}

async function submitStudentPdf(event, subject) {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.querySelector("#student-pdf").files?.[0];
  const message = form.querySelector("#student-upload-message");
  const progress = form.querySelector("#student-progress");
  if (!file) return setMessage(message, "Choose a PDF before submitting.", "error");
  const error = await validatePdf(file);
  if (error) return setMessage(message, error, "error");
  setFormBusy(form, true, "Starting upload…");
  progress.classList.add("active");
  try {
    const started = await invokeFunction("start-submission-upload", {
      subject_slug: subject.slug,
      original_filename: file.name,
      byte_size: file.size,
      mime_type: file.type || "application/pdf",
    });
    if (started.error) throw started.error;
    await putStagingPdf(started.data.staging_path, file, (percent) => updateProgress(progress, percent));
    const finished = await invokeFunction("finish-submission-upload", {
      submission_id: started.data.submission_id,
    });
    if (finished.error) throw finished.error;
    setMessage(message, "Your PDF has been submitted and dated by the portal.", "success");
    await loadDashboard();
    await openSubject(subject.slug);
  } catch (uploadError) {
    setMessage(message, humanError(uploadError.message || "The PDF could not be uploaded."), "error");
    progress.classList.remove("active");
    setFormBusy(form, false);
  }
}

async function submitWorkbookPdf(event, subject) {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.querySelector("#workbook-pdf").files?.[0];
  const message = form.querySelector("#workbook-upload-message");
  const progress = form.querySelector("#workbook-progress");
  if (!file) return setMessage(message, "Choose a workbook PDF first.", "error");
  const error = await validatePdf(file);
  if (error) return setMessage(message, error, "error");
  setFormBusy(form, true, "Starting upload…");
  progress.classList.add("active");
  try {
    const started = await invokeFunction("start-workbook-upload", {
      subject_slug: subject.slug,
      original_filename: file.name,
      byte_size: file.size,
      mime_type: file.type || "application/pdf",
    });
    if (started.error) throw started.error;
    await putStagingPdf(started.data.staging_path, file, (percent) => updateProgress(progress, percent));
    const finished = await invokeFunction("finish-workbook-upload", {
      workbook_version_id: started.data.workbook_version_id,
    });
    if (finished.error) throw finished.error;
    await loadDashboard();
    await openSubject(subject.slug);
  } catch (uploadError) {
    setMessage(message, humanError(uploadError.message || "The workbook PDF could not be uploaded."), "error");
    progress.classList.remove("active");
    setFormBusy(form, false);
  }
}

async function validatePdf(file) {
  if (file.size > PORTAL_CONFIG.maxPdfBytes) return "The PDF must be 25 MB or smaller.";
  if (!file.name.toLowerCase().endsWith(".pdf")) return "Choose a file whose name ends in .pdf.";
  if (file.type && file.type !== "application/pdf") return "This file is not marked as a PDF by your device.";
  const signature = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
  if (signature !== "%PDF-") return "This does not appear to be a PDF file.";
  return "";
}

async function putStagingPdf(stagingPath, file, onProgress) {
  if (!stagingPath || !state.session) throw new Error("The secure upload session could not be started. Please try again.");

  // Supabase recommends its resumable TUS route for files above 6 MB and for
  // unreliable connections. This keeps the student/mentor side resumable too;
  // the later Google Drive transfer happens only from the secure server.
  const tus = await import("https://esm.sh/tus-js-client@4.3.1?bundle");
  const projectHost = new URL(PORTAL_CONFIG.supabaseUrl).hostname.replace(".supabase.co", ".storage.supabase.co");
  const endpoint = `https://${projectHost}/storage/v1/upload/resumable`;
  onProgress(3);

  await new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${state.session.access_token}`,
        apikey: PORTAL_CONFIG.supabaseAnonKey,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      allowedMetaFields: ["bucketName", "objectName", "contentType", "cacheControl"],
      metadata: {
        bucketName: "portal-staging",
        objectName: stagingPath,
        contentType: "application/pdf",
        cacheControl: "0",
      },
      onError: (uploadError) => reject(new Error(uploadError?.message || "The secure upload was interrupted. Please try again.")),
      onProgress: (uploaded, total) => onProgress(3 + Math.round((uploaded / total) * 69)),
      onSuccess: () => {
        onProgress(72);
        resolve();
      },
    });
    upload.start();
  });
}

function updateProgress(container, percent) {
  container.querySelector("span").style.width = `${Math.max(0, Math.min(percent, 100))}%`;
}

async function openDrivePdf(kind, id) {
  if (!state.session) return;
  const parameter = kind === "workbook" ? "workbook_version_id" : "submission_id";
  const response = await fetch(`${functionBase}/get-drive-pdf?${parameter}=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${state.session.access_token}` },
  });
  if (!response.ok) return alert("This PDF could not be opened. Please try again.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  openPdfModal(url, kind === "workbook" ? "Workbook PDF" : "Submitted PDF");
}

function openPdfModal(url, title) {
  const modal = document.createElement("div");
  modal.className = "portal-modal-backdrop";
  modal.innerHTML = `<section class="portal-modal" role="dialog" aria-modal="true" aria-labelledby="pdf-title"><div class="portal-modal-head"><h2 id="pdf-title">${escapeHtml(title)}</h2><button type="button" class="portal-icon-button" aria-label="Close PDF reader">×</button></div><div class="portal-workbook-viewer"><iframe title="${escapeHtml(title)}" src="${url}"></iframe></div></section>`;
  const close = () => { URL.revokeObjectURL(url); modal.remove(); };
  modal.querySelector("button").addEventListener("click", close);
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  document.body.append(modal);
}

async function handleMentorAction(action) {
  if (action === "approvals") await renderMentorApprovals();
  if (action === "drive-setup") {
    app.innerHTML = `<section class="portal-loading" aria-live="polite"><span class="portal-loading-dot"></span>Connecting the contest Google Drive folders…</section>`;
    const response = await invokeFunction("bootstrap-drive", {});
    state.dashboardNotice = response.error
      ? { type: "error", message: humanError(response.error.message) }
      : { type: "success", message: "Google Drive is connected. The portal can now create the protected contest folders as students and mentors upload PDFs." };
    renderDashboard();
  }
}

async function renderMentorApprovals() {
  app.innerHTML = `<section class="portal-loading" aria-live="polite"><span class="portal-loading-dot"></span>Loading mentor requests…</section>`;
  const response = await invokeFunction("list-mentor-approvals", {});
  if (response.error) return renderErrorPage(humanError(response.error.message));
  const requests = response.data?.requests || [];
  app.innerHTML = `<div class="portal-shell"><button class="portal-back-link" id="back-dashboard" type="button">← Back to dashboard</button><section class="portal-panel"><p class="portal-eyebrow">Super-admin only</p><h1 style="font-size:clamp(2rem,4vw,3rem);">Mentor approvals</h1><p class="portal-lede">A mentor applicant must verify their own email first. The one-time code shown in this list must match the code delivered to ${escapeHtml(PORTAL_CONFIG.supportEmail)}.</p>${requests.length ? `<div class="portal-submission-list">${requests.map((request) => `<article class="portal-submission-item"><span><strong>${escapeHtml(request.display_name)}</strong><span>${escapeHtml(request.email)} · requested ${formatDate(request.created_at, true)}</span></span><button class="portal-button" type="button" data-approve-mentor="${request.id}">Approve</button></article>`).join("")}</div>` : `<p class="portal-muted">There are no pending mentor requests.</p>`}</section></div>`;
  document.querySelector("#back-dashboard").addEventListener("click", loadDashboard);
  document.querySelectorAll("[data-approve-mentor]").forEach((button) => button.addEventListener("click", () => promptMentorApproval(button.dataset.approveMentor)));
}

function promptMentorApproval(requestId) {
  const modal = document.createElement("div");
  modal.className = "portal-modal-backdrop";
  modal.innerHTML = `<section class="portal-modal" role="dialog" aria-modal="true" aria-labelledby="approve-title"><div class="portal-modal-head"><h2 id="approve-title">Approve mentor</h2><button class="portal-icon-button" type="button" aria-label="Close">×</button></div><form id="approve-form" class="portal-form" style="padding:0;"><div class="portal-field"><label for="approval-code">Code sent to the contest Gmail <span class="portal-required">*</span></label><input id="approval-code" name="code" inputmode="numeric" maxlength="8" autocomplete="one-time-code" required /></div><div class="portal-button-row"><button class="portal-button" type="submit">Approve mentor</button></div><p class="portal-form-message"></p></form></section>`;
  const close = () => modal.remove();
  modal.querySelector(".portal-icon-button").addEventListener("click", close);
  modal.querySelector("#approve-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const code = String(new FormData(form).get("code") || "").trim();
    const message = form.querySelector(".portal-form-message");
    if (!/^\d{6,8}$/.test(code)) return setMessage(message, "Enter the approval code from the contest email.", "error");
    setFormBusy(form, true, "Approving…");
    const result = await invokeFunction("approve-mentor", { approval_request_id: requestId, code });
    if (result.error) { setMessage(message, humanError(result.error.message), "error"); setFormBusy(form, false); return; }
    close();
    await renderMentorApprovals();
  });
  document.body.append(modal);
}

async function invokeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return { data, error: null };

  // Supabase retains the server-written explanation on a failed Function
  // response. Show that explanation instead of a generic status message.
  const response = error.context;
  if (response && typeof response.json === "function") {
    try {
      const payload = await response.json();
      const message = String(payload?.error || payload?.message || "").trim();
      if (message) return { data, error: new Error(message) };
    } catch {
      // Keep the original error if the response does not contain JSON.
    }
  }
  return { data, error };
}

function setFormBusy(form, busy, busyText = "Working…") {
  const button = form.querySelector("button[type=submit]");
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function setMessage(element, text, type = "") {
  element.textContent = text;
  element.className = `portal-form-message ${type === "error" ? "portal-error" : type === "success" ? "portal-success" : ""}`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function humanError(message = "") {
  const lower = String(message).toLowerCase();
  if (lower.includes("email not confirmed")) return "Check your email and open the verification link before signing in.";
  if (lower.includes("invalid login")) return "That email address or password was not recognised.";
  if (lower.includes("already registered")) return "An account already exists for this email address. Sign in instead.";
  return message || "Something went wrong. Please try again.";
}

async function signOut() {
  await supabase.auth.signOut();
  state.session = null;
  state.user = null;
  state.profile = null;
  state.templates = [];
  state.submissions = [];
  state.comments = [];
  state.authMode = "sign-in";
  renderLanding();
}

async function initialize() {
  if (!configReady) return renderLanding();
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    supabase = createClient(PORTAL_CONFIG.supabaseUrl, PORTAL_CONFIG.supabaseAnonKey);
  } catch {
    portalAvailable = false;
    return renderLanding("The portal interface could not be loaded. Check your internet connection and refresh.", "error");
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (session) await bootAuthenticated();
  else renderLanding();
  supabase.auth.onAuthStateChange(async (_event, nextSession) => {
    if (!nextSession) return;
    state.session = nextSession;
  });
}

initialize();
