import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requiredEnv } from "./portal.ts";

type DriveFile = { id: string; name: string; mimeType: string; parents?: string[]; size?: string; createdTime?: string };

function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function googleAccessToken() {
  const body = new URLSearchParams({
    client_id: requiredEnv("GOOGLE_CLIENT_ID"),
    client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
    refresh_token: requiredEnv("GOOGLE_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!response.ok) throw new Error("Google Drive authorization could not be refreshed.");
  const data = await response.json();
  if (!data.access_token) throw new Error("Google Drive did not return an access token.");
  return data.access_token as string;
}

async function driveRequest(accessToken: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(`https://www.googleapis.com/drive/v3${path}`, { ...init, headers });
}

export async function getOrCreateFolder(accessToken: string, parentId: string, name: string) {
  const query = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and name = '${escapeDriveQuery(name)}' and '${escapeDriveQuery(parentId)}' in parents and trashed = false`);
  const found = await driveRequest(accessToken, `/files?q=${query}&pageSize=1&fields=files(id,name)`);
  if (!found.ok) throw new Error("Google Drive folder lookup failed.");
  const result = await found.json();
  if (result.files?.[0]?.id) return result.files[0].id as string;
  const created = await driveRequest(accessToken, "/files?fields=id,name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  if (!created.ok) throw new Error("Google Drive folder could not be created.");
  return (await created.json()).id as string;
}

export async function getOrCreateFolderPath(accessToken: string, rootFolderId: string, segments: string[]) {
  let parentId = rootFolderId;
  for (const segment of segments) parentId = await getOrCreateFolder(accessToken, parentId, segment);
  return parentId;
}

export async function createPdfFile(accessToken: string, parentId: string, name: string) {
  const response = await driveRequest(accessToken, "/files?fields=id,name,mimeType,parents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/pdf", parents: [parentId] }),
  });
  if (!response.ok) throw new Error("Google Drive file could not be created.");
  return await response.json() as DriveFile;
}

export async function createResumableUpload(accessToken: string, fileId: string, byteSize: number) {
  const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=resumable&fields=id,name,mimeType,parents,size,createdTime`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "application/pdf",
      "X-Upload-Content-Length": String(byteSize),
    },
    body: "{}",
  });
  const location = response.headers.get("Location");
  if (!response.ok || !location) throw new Error("Google Drive could not prepare the upload.");
  return location;
}

export async function getDriveFile(accessToken: string, fileId: string) {
  const response = await driveRequest(accessToken, `/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,parents,size,createdTime`);
  if (!response.ok) throw new Error("The uploaded Google Drive file could not be checked.");
  return await response.json() as DriveFile;
}

export async function verifyPdfFile(accessToken: string, fileId: string, expectedParentId: string, expectedSize: number) {
  const file = await getDriveFile(accessToken, fileId);
  if (file.mimeType !== "application/pdf") throw new Error("Google Drive did not identify the upload as a PDF.");
  if (!file.parents?.includes(expectedParentId)) throw new Error("The uploaded file is not in its expected contest folder.");
  if (Number(file.size) !== expectedSize) throw new Error("The uploaded file size does not match the selected PDF.");
  const response = await driveRequest(accessToken, `/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Range: "bytes=0-4" } });
  if (!response.ok) throw new Error("The uploaded PDF could not be checked.");
  const prefix = (await response.arrayBuffer()).slice(0, 5);
  const signature = new TextDecoder().decode(prefix);
  if (signature !== "%PDF-") throw new Error("The uploaded file does not contain a valid PDF signature.");
  return file;
}

export async function deleteDriveFile(accessToken: string, fileId: string) {
  await driveRequest(accessToken, `/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
}

export async function streamDrivePdf(accessToken: string, fileId: string) {
  const response = await driveRequest(accessToken, `/files/${encodeURIComponent(fileId)}?alt=media`);
  if (!response.ok || !response.body) throw new Error("The PDF could not be read from Google Drive.");
  return response;
}

export type DriveRootSetting = "google_drive_submissions_root_id" | "google_drive_workbooks_root_id";

/**
 * The root IDs are created once by the super-admin and stored in a table that
 * browser clients cannot read. This means the Google account need not expose
 * manually copied folder IDs as deployment secrets.
 */
export async function getDriveRootId(admin: SupabaseClient, setting: DriveRootSetting) {
  const { data, error } = await admin
    .from("portal_settings")
    .select("setting_value")
    .eq("setting_key", setting)
    .maybeSingle();
  if (error) throw new Error("The Google Drive folder setup could not be checked.");
  if (!data?.setting_value) {
    throw new Error("Google Drive folders have not been connected yet. Ask the super-admin to connect them from the portal.");
  }
  return data.setting_value;
}
