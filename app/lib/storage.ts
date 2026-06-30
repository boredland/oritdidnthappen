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

/**
 * Workers `fetch` streams a request body when given a `ReadableStream` plus
 * `duplex: "half"`, but the Workers `RequestInit` type omits `duplex`. This
 * widens it for the two providers' streaming uploads.
 */
export type StreamRequestInit = RequestInit & { duplex: "half" };

/**
 * Hash a byte stream to a SHA-256 hex string, returning the byte count too.
 *
 * Production (workerd) exposes `crypto.DigestStream` — a WritableStream hash
 * sink that never retains the data, so the upload stays memory-flat. The vite
 * dev server runs the worker under Node, which has no `DigestStream`, so there
 * we buffer the stream and fall back to `crypto.subtle.digest`. Identical hash
 * either way, so per-event dedup is consistent across dev and prod.
 */
export async function hashStreamToHex(
  stream: ReadableStream<Uint8Array>,
): Promise<{ hex: string; bytes: number }> {
  const maybe = crypto as unknown as { DigestStream?: typeof DigestStream };
  let digest: ArrayBuffer;
  let bytes: number;
  if (typeof maybe.DigestStream === "function") {
    const ds = new maybe.DigestStream("SHA-256");
    await stream.pipeTo(ds);
    digest = await ds.digest;
    bytes = Number(ds.bytesWritten);
  } else {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        bytes += value.length;
      }
    }
    const buf = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      buf.set(chunk, offset);
      offset += chunk.length;
    }
    digest = await crypto.subtle.digest("SHA-256", buf);
  }
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { hex, bytes };
}

export interface StorageProvider {
  id: Provider;
  label: string;
  getAuthUrl(env: Bindings, state: string): string;
  exchangeCode(env: Bindings, code: string): Promise<TokenSet>;
  refreshAccessToken(env: Bindings, refreshToken: string): Promise<TokenSet>;
  createFolder(accessToken: string, name: string): Promise<FolderResult>;
  /** Stream a file's bytes straight to the provider without buffering. Returns its file_ref. */
  streamUpload(
    accessToken: string,
    folderId: string,
    filename: string,
    mimeType: string,
    body: ReadableStream<Uint8Array>,
  ): Promise<UploadResult>;
  /** Stream original bytes back, forwarding an HTTP Range header for seekable playback. */
  streamMedia(
    accessToken: string,
    fileRef: string,
    range: string | null,
  ): Promise<Response>;
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
