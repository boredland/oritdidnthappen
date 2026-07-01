import type { Bindings } from "../global";
import type {
  FolderResult,
  StorageProvider,
  StreamRequestInit,
  ThumbSize,
  TokenSet,
  UploadResult,
} from "./storage";
import { redirectUri } from "./storage";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_RESUMABLE =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

// Rendered edge (px) for grid thumbnails; covers 2x DPR on the ~300px tiles.
const GRID_THUMB_EDGE = 600;

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
      throw new Error(
        `Google token exchange failed: ${res.status} ${bodyText}`,
      );
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

  async createFolder(accessToken: string, name: string): Promise<FolderResult> {
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

  async streamUpload(
    accessToken: string,
    folderId: string,
    filename: string,
    mimeType: string,
    body: ReadableStream<Uint8Array>,
  ): Promise<UploadResult> {
    // Resumable upload is the only Drive form that streams the bytes AND sets
    // name + parent: step 1 opens a session, step 2 streams the body to it.
    const init = await fetch(DRIVE_UPLOAD_RESUMABLE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
      },
      body: JSON.stringify({ name: filename, parents: [folderId] }),
    });
    if (!init.ok) {
      throw new Error(
        `Google upload session failed: ${init.status} ${await init.text()}`,
      );
    }
    const sessionUri = init.headers.get("Location");
    if (!sessionUri) {
      throw new Error("Google upload session missing Location");
    }

    const putInit: StreamRequestInit = {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body,
      duplex: "half",
    };
    const res = await fetch(sessionUri, putInit);
    if (!res.ok) {
      throw new Error(
        `Google upload failed: ${res.status} ${await res.text()}`,
      );
    }
    const json = (await res.json()) as { id: string };
    return { fileRef: json.id };
  },

  async streamMedia(
    accessToken: string,
    fileRef: string,
    range: string | null,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    if (range) headers.Range = range;
    return fetch(`${DRIVE_FILES}/${fileRef}?alt=media`, { headers });
  },

  async getThumbnail(
    accessToken: string,
    fileRef: string,
    size: ThumbSize,
  ): Promise<Response> {
    const original = () =>
      fetch(`${DRIVE_FILES}/${fileRef}?alt=media`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

    // Full size streams the original bytes. The grid uses Drive's pre-rendered
    // `thumbnailLink` (a private lh3.googleusercontent.com URL ending in =sNNN),
    // which is orders of magnitude smaller than the multi-MB original.
    if (size === "full") return original();

    const meta = await fetch(`${DRIVE_FILES}/${fileRef}?fields=thumbnailLink`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meta.ok) return original();
    const { thumbnailLink } = (await meta.json()) as {
      thumbnailLink?: string;
    };
    if (!thumbnailLink) return original();

    // Override Drive's default size directive (e.g. `=s220`, `=s220-c`,
    // `=w220-h220`) so the grid renders at GRID_THUMB_EDGE.
    const url = thumbnailLink.replace(/=[swh].*$/, `=s${GRID_THUMB_EDGE}`);
    const thumb = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return thumb.ok ? thumb : original();
  },

  isFileNotFound(res: Response): boolean {
    // Drive returns 404 for a deleted file. The grid path fetches metadata
    // first (also 404), and the full path fetches alt=media (also 404).
    return res.status === 404;
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
