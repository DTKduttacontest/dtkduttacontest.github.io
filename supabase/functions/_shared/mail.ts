import { requiredEnv } from "./portal.ts";

export async function sendApprovalCodeEmail(input: { applicantName: string; applicantEmail: string; code: string }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${requiredEnv("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: requiredEnv("MAIL_FROM"),
      to: [requiredEnv("MENTOR_APPROVER_EMAIL")],
      subject: "DTK Dutta Contest: mentor approval code",
      html: `<h2>Mentor approval requested</h2><p><strong>${escapeHtml(input.applicantName)}</strong> (${escapeHtml(input.applicantEmail)}) has verified their own email and requested mentor access.</p><p>Enter this code inside the signed-in super-admin portal within 15 minutes:</p><p style="font-size:28px;letter-spacing:4px;font-weight:700">${input.code}</p><p>Do not forward this code to the applicant.</p>`,
    }),
  });
  if (!response.ok) throw new Error("The mentor approval code could not be sent to the contest email.");
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
