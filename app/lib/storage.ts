import type { Bindings } from "../global";
import { decryptToken, encryptToken } from "./crypto";
import {
  type EventRow,
  type Provider,
  updateEventAccessToken,
} from "./db";
import { googleDrive } from "./google";
import { dropbox } from "./dropbox";

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Lifetime in seconds, or null if the provider doesn't expire tokens. */
  expiresIn: number | null;
}

export interface FolderResult {
  folderId: string;
  folderUrl: string | null;
}

export interface UploadResult {
  /** Opaque, provider-specific handle stored in `photos.file_ref`. */
  fileRef: string;
}

export type ThumbSize = "grid" | "full";

export interface StorageProvider {
  id: Provider;
  label: string;
  getAuthUrl(env: Bindings, state: string): string;
  exchangeCode(env: Bindings, code: string): Promise<TokenSet>;
  refreshAccessToken(env: Bindings, refreshToken: string): Promise<TokenSet>;
  createFolder(accessToken: string, name: string): Promise<FolderResult>;
  uploadFile(
    accessToken: string,
    folderId: string,
    filename: string,
    mimeType: string,
    data: ArrayBuffer,
  ): Promise<UploadResult>;
  /**
   * Returns an image Response (thumbnail bytes) to stream to the client.
   * `grid` is a small, cheap thumbnail for the gallery; `full` is high
   * quality for the lightbox / cover / native share.
   */
  getThumbnail(
    accessToken: string,
    fileRef: string,
    size: ThumbSize,
  ): Promise<Response>;
  /** Returns true when a thumbnail response indicates the file is gone from the host's cloud (404 / path_lookup/not_found). */
  isFileNotFound(res: Response): boolean;
  /** Best-effort delete of a previously uploaded file by its fileRef. */
  deleteFile(accessToken: string, fileRef: string): Promise<void>;
}

const PROVIDERS: Record<Provider, StorageProvider> = {
  google_drive: googleDrive,
  dropbox,
};

export function getProvider(id: Provider): StorageProvider {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`Unknown storage provider: ${id}`);
  return p;
}

export function redirectUri(env: Bindings, provider: Provider): string {
  const path = provider === "google_drive" ? "google" : "dropbox";
  return `${env.BASE_URL}/api/oauth/${path}`;
}

/** Refresh 60s before the recorded expiry to absorb clock skew + latency. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Decrypt the event's access token, refreshing + re-persisting if it is at or
 * near expiry. Returns a usable plaintext access token. Providers without
 * expiry (Dropbox legacy) simply return the stored token.
 */
export async function ensureValidToken(
  db: D1Database,
  env: Bindings,
  event: EventRow,
): Promise<string> {
  if (!event.access_token) {
    throw new Error("Event has no connected storage");
  }
  const accessToken = await decryptToken(event.access_token, env.ENCRYPTION_KEY);

  const stillValid =
    event.token_expiry == null ||
    event.token_expiry - Date.now() > EXPIRY_SKEW_MS;
  if (stillValid) return accessToken;

  if (!event.refresh_token) return accessToken;
  const refreshToken = await decryptToken(
    event.refresh_token,
    env.ENCRYPTION_KEY,
  );

  const provider = getProvider(event.provider);
  const refreshed = await provider.refreshAccessToken(env, refreshToken);
  const newExpiry = refreshed.expiresIn
    ? Date.now() + refreshed.expiresIn * 1000
    : Date.now() + 3600 * 1000;

  const encrypted = await encryptToken(
    refreshed.accessToken,
    env.ENCRYPTION_KEY,
  );
  await updateEventAccessToken(db, event.id, encrypted, newExpiry);
  return refreshed.accessToken;
}
