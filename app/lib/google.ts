import type { Bindings } from "../global";
import type {
  FolderResult,
  StorageProvider,
  TokenSet,
  UploadResult,
} from "./storage";
import { redirectUri } from "./storage";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

export const googleDrive: StorageProvider = {
  id: "google_drive",
  label: "Google Drive",

  getAuthUrl(env: Bindings, state: string): string {
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(env, "google_drive"),
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  },

  async exchangeCode(env: Bindings, code: string): Promise<TokenSet> {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(env, "google_drive"),
        grant_type: "authorization_code",
      }),
    });
    const bodyText = await res.text();
    let json: GoogleTokenResponse;
    try {
      json = JSON.parse(bodyText) as GoogleTokenResponse;
    } catch {
      throw new Error(`Google token exchange failed: ${res.status} ${bodyText}`);
    }
    if (!res.ok || json.error) {
      throw new Error(
        `Google token exchange failed: ${res.status} ${json.error ?? ""} ${json.error_description ?? bodyText}`,
      );
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
      expiresIn: json.expires_in,
    };
  },

  async refreshAccessToken(
    env: Bindings,
    refreshToken: string,
  ): Promise<TokenSet> {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        grant_type: "refresh_token",
      }),
    });
    const json = (await res.json()) as GoogleTokenResponse;
    if (!res.ok || json.error) {
      throw new Error(
        `Google token refresh failed: ${json.error_description ?? json.error ?? res.status}`,
      );
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? refreshToken,
      expiresIn: json.expires_in,
    };
  },

  async createFolder(
    accessToken: string,
    name: string,
  ): Promise<FolderResult> {
    const res = await fetch(DRIVE_FILES, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
      }),
    });
    if (!res.ok) {
      throw new Error(`Google folder creation failed: ${res.status}`);
    }
    const json = (await res.json()) as { id: string };
    return {
      folderId: json.id,
      folderUrl: `https://drive.google.com/drive/folders/${json.id}`,
    };
  },

  async uploadFile(
    accessToken: string,
    folderId: string,
    filename: string,
    mimeType: string,
    data: ArrayBuffer,
  ): Promise<UploadResult> {
    const boundary = `pd${crypto.randomUUID().replace(/-/g, "")}`;
    const metadata = JSON.stringify({ name: filename, parents: [folderId] });

    const encoder = new TextEncoder();
    const preamble = encoder.encode(
      `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${metadata}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`,
    );
    const epilogue = encoder.encode(`\r\n--${boundary}--\r\n`);

    const body = new Uint8Array(
      preamble.length + data.byteLength + epilogue.length,
    );
    body.set(preamble, 0);
    body.set(new Uint8Array(data), preamble.length);
    body.set(epilogue, preamble.length + data.byteLength);

    const res = await fetch(DRIVE_UPLOAD, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!res.ok) {
      throw new Error(
        `Google upload failed: ${res.status} ${await res.text()}`,
      );
    }
    const json = (await res.json()) as { id: string };
    return { fileRef: json.id };
  },

  async getThumbnail(accessToken: string, fileRef: string): Promise<Response> {
    return fetch(`${DRIVE_FILES}/${fileRef}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  },

  async deleteFile(accessToken: string, fileRef: string): Promise<void> {
    const res = await fetch(`${DRIVE_FILES}/${fileRef}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // 404 = already gone; treat as success.
    if (!res.ok && res.status !== 404) {
      throw new Error(`Google delete failed: ${res.status}`);
    }
  },
};
