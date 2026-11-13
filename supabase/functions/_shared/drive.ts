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

/**
 * Upload a verified staging PDF from the server to its final Drive file.
 *
 * Drive recommends resumable uploads for files over 5 MB.  The entire
 * exchange stays server-to-server: the browser never receives the Google
 * session URL, so Drive's browser CORS behaviour cannot interrupt a student
 * or mentor upload.  Four-MiB chunks are exact multiples of Drive's required
 * 256-KiB chunk unit and keep every individual transfer comfortably small.
 */
export async function uploadPdfContent(accessToken: string, fileId: string, bytes: Uint8Array) {
  const initiation = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=resumable&fields=id,name,mimeType,parents,size,createdTime`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "X-Upload-Content-Type": "application/pdf",
      "X-Upload-Content-Length": String(bytes.byteLength),
      "Content-Length": "0",
    },
  });
  const sessionUrl = initiation.headers.get("Location");
  if (!initiation.ok || !sessionUrl) throw new Error("Google Drive could not start a reliable PDF upload.");

  const total = bytes.byteLength;
  const chunkSize = 4 * 1024 * 1024;
  let start = 0;
  let retries = 0;

  while (start < total) {
    const endExclusive = Math.min(start + chunkSize, total);
    const chunk = bytes.slice(start, endExclusive);
    const response = await fetch(sessionUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(chunk.byteLength),
        "Content-Range": `bytes ${start}-${endExclusive - 1}/${total}`,
      },
      body: chunk,
    });

    if (response.ok) return await response.json() as DriveFile;

    if (response.status === 308) {
      const range = response.headers.get("Range");
      const match = range?.match(/bytes=0-(\d+)/i);
      // Drive omits Range only when it has not confirmed any bytes yet.
      // Restarting at zero is safe; advancing would risk skipping data.
      start = match ? Number(match[1]) + 1 : 0;
      retries = 0;
      continue;
    }

    // A resumable session lets us safely ask Drive how much it actually
    // received after a transient server/network failure before retrying.
    if (response.status >= 500 && response.status < 600 && retries < 2) {
      retries += 1;
      const status = await fetch(sessionUrl, {
        method: "PUT",
        headers: {
          "Content-Length": "0",
          "Content-Range": `bytes */${total}`,
        },
      });
      if (status.ok) return await getDriveFile(accessToken, fileId);
      if (status.status === 308) {
        const range = status.headers.get("Range");
        const match = range?.match(/bytes=0-(\d+)/i);
        start = match ? Number(match[1]) + 1 : 0;
        continue;
      }
    }

    throw new Error("Google Drive could not save the PDF.");
  }

  // The final response normally returns the file metadata. This defensive
  // fallback only applies if Drive reports every chunk as incomplete.
  return await getDriveFile(accessToken, fileId);
}

export async function readAndValidateStagingPdf(admin: SupabaseClient, stagingPath: string, expectedSize: number) {
  const { data, error } = await admin.storage.from("portal-staging").download(stagingPath);
  if (error || !data) throw new Error("The uploaded PDF could not be read from secure staging storage.");
  if (data.size !== expectedSize) throw new Error("The uploaded PDF size does not match the selected file.");
  const bytes = new Uint8Array(await data.arrayBuffer());
  const signature = new TextDecoder().decode(bytes.slice(0, 5));
  if (signature !== "%PDF-") throw new Error("The uploaded file does not contain a valid PDF signature.");
  return bytes;
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
