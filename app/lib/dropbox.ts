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

const AUTH_ENDPOINT = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_ENDPOINT = "https://api.dropboxapi.com/oauth2/token";
const CREATE_FOLDER = "https://api.dropboxapi.com/2/files/create_folder_v2";
const UPLOAD = "https://content.dropboxapi.com/2/files/upload";
const DOWNLOAD = "https://content.dropboxapi.com/2/files/download";
const GET_THUMBNAIL = "https://content.dropboxapi.com/2/files/get_thumbnail_v2";
const DELETE_FILE = "https://api.dropboxapi.com/2/files/delete_v2";
const SCOPE = "files.content.write files.content.read";

interface DropboxTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

/**
 * Dropbox-API-Arg must be HTTP-header safe: ASCII only, non-ASCII escaped as
 * \uXXXX. JSON.stringify already escapes control chars; we additionally escape
 * any remaining non-ASCII so filenames with accents/emoji don't break headers.
 */
function apiArg(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) => {
    return "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
  });
}

export const dropbox: StorageProvider = {
  id: "dropbox",
  label: "Dropbox",

  getAuthUrl(env: Bindings, state: string): string {
    const params = new URLSearchParams({
      client_id: env.DROPBOX_CLIENT_ID,
      redirect_uri: redirectUri(env, "dropbox"),
      response_type: "code",
      token_access_type: "offline",
      scope: SCOPE,
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
        grant_type: "authorization_code",
        client_id: env.DROPBOX_CLIENT_ID,
        client_secret: env.DROPBOX_CLIENT_SECRET,
        redirect_uri: redirectUri(env, "dropbox"),
      }),
    });
    const json = (await res.json()) as DropboxTokenResponse;
    if (!res.ok || json.error) {
      throw new Error(
        `Dropbox token exchange failed: ${json.error_description ?? json.error ?? res.status}`,
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
        grant_type: "refresh_token",
        client_id: env.DROPBOX_CLIENT_ID,
        client_secret: env.DROPBOX_CLIENT_SECRET,
      }),
    });
    const json = (await res.json()) as DropboxTokenResponse;
    if (!res.ok || json.error) {
      throw new Error(
        `Dropbox token refresh failed: ${json.error_description ?? json.error ?? res.status}`,
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
    const path = `/${name.replace(/^\/+/, "")}`;
    const res = await fetch(CREATE_FOLDER, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path, autorename: true }),
    });
    if (!res.ok) {
      throw new Error(
        `Dropbox folder creation failed: ${res.status} ${await res.text()}`,
      );
    }
    const json = (await res.json()) as {
      metadata: { path_lower: string };
    };
    const folderId = json.metadata.path_lower;
    return {
      folderId,
      folderUrl: `https://www.dropbox.com/home${folderId}`,
    };
  },

  async streamUpload(
    accessToken: string,
    folderId: string,
    filename: string,
    _mimeType: string,
    body: ReadableStream<Uint8Array>,
  ): Promise<UploadResult> {
    // Single-request upload caps at 150 MB, well above our 90 MB ceiling, so
    // the body streams straight through without the chunked-session dance.
    const path = `${folderId}/${filename}`;
    const init: StreamRequestInit = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": apiArg({
          path,
          mode: "add",
          autorename: true,
          mute: true,
        }),
      },
      body,
      duplex: "half",
    };
    const res = await fetch(UPLOAD, init);
    if (!res.ok) {
      throw new Error(
        `Dropbox upload failed: ${res.status} ${await res.text()}`,
      );
    }
    const json = (await res.json()) as { path_lower: string };
    return { fileRef: json.path_lower };
  },

  async streamMedia(
    accessToken: string,
    fileRef: string,
    range: string | null,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Arg": apiArg({ path: fileRef }),
    };
    if (range) headers.Range = range;
    return fetch(DOWNLOAD, { method: "POST", headers });
  },

  async getThumbnail(
    accessToken: string,
    fileRef: string,
    size: ThumbSize,
  ): Promise<Response> {
    return fetch(GET_THUMBNAIL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Dropbox-API-Arg": apiArg({
          resource: { ".tag": "path", path: fileRef },
          format: "jpeg",
          size: size === "full" ? "w2048h1536" : "w640h480",
          mode: "strict",
        }),
      },
    });
  },

  isFileNotFound(res: Response): boolean {
    // Dropbox returns 409 with path_lookup/not_found for a deleted file.
    // Our file_ref was created at upload, so a 409 here is a dangling ref.
    return res.status === 409;
  },

  async deleteFile(accessToken: string, fileRef: string): Promise<void> {
    const res = await fetch(DELETE_FILE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: fileRef }),
    });
    // path_lookup/not_found means it's already gone; treat as success.
    if (!res.ok) {
      const body = await res.text();
      if (!body.includes("not_found")) {
        throw new Error(`Dropbox delete failed: ${res.status} ${body}`);
      }
    }
  },
};
