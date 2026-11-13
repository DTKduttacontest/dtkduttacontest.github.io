import { requiredEnv } from "./portal.ts";

type RelayRequest = {
  request_id: string;
  applicant_name: string;
  applicant_email: string;
  code: string;
  timestamp: number;
  nonce: string;
  signature: string;
};

/**
 * Sends mentor-approval notices through the contest Gmail's protected Apps
 * Script relay. The public endpoint accepts only short-lived HMAC-signed
 * requests and never accepts a recipient address.
 */
export async function sendApprovalCodeEmail(input: { applicantName: string; applicantEmail: string; code: string }) {
  const request: Omit<RelayRequest, "signature"> = {
    request_id: crypto.randomUUID(),
    applicant_name: input.applicantName,
    applicant_email: input.applicantEmail,
    code: input.code,
    timestamp: Math.floor(Date.now() / 1000),
    nonce: randomNonce(),
  };
  const signature = await hmacHex(
    requiredEnv("GOOGLE_APPS_SCRIPT_MAIL_RELAY_SECRET"),
    canonicalRequest(request),
  );

  let response: Response;
  try {
    response = await fetch(requiredEnv("GOOGLE_APPS_SCRIPT_MAIL_RELAY_URL"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, signature }),
    });
  } catch {
    throw new Error("The mentor approval email could not be sent to the contest email.");
  }

  if (!response.ok) throw new Error("The mentor approval email could not be sent to the contest email.");
  let result: { ok?: unknown } | null = null;
  try {
    result = await response.json();
  } catch {
    // Apps Script can return an HTML error page when a deployment is changed
    // or disabled. Treat that as a delivery failure rather than accepting an
    // uncertain result.
  }
  if (result?.ok !== true) throw new Error("The mentor approval email could not be sent to the contest email.");
}

function canonicalRequest(request: Omit<RelayRequest, "signature">) {
  return [
    "v1",
    request.request_id,
    request.applicant_name,
    request.applicant_email,
    request.code,
    String(request.timestamp),
    request.nonce,
  ].map((value) => encodeURIComponent(value)).join("\n");
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
