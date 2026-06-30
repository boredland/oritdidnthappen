import { createRoute } from "honox/factory";
import { generateId } from "../../../lib/crypto";
import {
  addPhoto,
  getEventByCode,
  getGuestBySession,
  getPhotoByHash,
  getPhotoById,
  setPhotoPoster,
} from "../../../lib/db";
import { notifyNewPhotos } from "../../../lib/notify";
import {
  ensureValidToken,
  getProvider,
  hashStreamToHex,
} from "../../../lib/storage";
import {
  IMAGE_ACCEPTED,
  IMAGE_MAX_BYTES,
  VIDEO_ACCEPTED,
  VIDEO_CEILING_BYTES,
} from "../../../lib/upload";

type FileKind = "image" | "video";
interface Item {
  id: string;
  username: string;
  createdAt: number;
  takenAt: number | null;
  kind: FileKind;
}

function decodeFilename(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export const POST = createRoute(async (c) => {
  async function verifyTurnstile(
    token: string,
    ip: string,
    env: typeof c.env,
  ): Promise<boolean> {
    const body = new URLSearchParams();
    body.append("secret", env.TURNSTILE_SECRET_KEY);
    body.append("response", token);
    body.append("remoteip", ip);
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body,
      },
    );
    const data = await res.json<{ success: boolean }>();
    return data.success;
  }

  const code = c.req.param("code");
  if (!code) return c.json({ error: "Missing code" }, 400);
  const auth = c.req.header("Authorization");
  const sessionToken = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!sessionToken) return c.json({ error: "Missing session" }, 401);

  const event = await getEventByCode(c.env.DB, code);
  const turnstileToken = c.req.header("X-Turnstile-Token");
  const ip = c.req.header("CF-Connecting-IP") || "127.0.0.1";
  if (!turnstileToken || !(await verifyTurnstile(turnstileToken, ip, c.env))) {
    return c.json({ error: "Bot verification failed" }, 400);
  }
  if (!event) return c.json({ error: "Unknown event" }, 404);

  const guest = await getGuestBySession(c.env.DB, event.id, sessionToken);
  if (!guest) return c.json({ error: "Invalid session" }, 401);

  const now = Math.floor(Date.now() / 1000);
  if (event.expires_at != null && event.expires_at <= now) {
    return c.json({ error: "Event is closed" }, 403);
  }
  if (!event.folder_id) {
    return c.json({ error: "Storage not connected" }, 409);
  }

  const mime = c.req.header("Content-Type") ?? "";
  const contentLength = Number(c.req.header("Content-Length")) || 0;
  const isImage = IMAGE_ACCEPTED.includes(mime);
  const isVideo = VIDEO_ACCEPTED.includes(mime);

  // Type gate. Images always pass; videos only when the host enabled them.
  if (!isImage && !isVideo) {
    return c.json({ error: "Unsupported type" }, 415);
  }
  if (isVideo && event.videos_enabled !== 1) {
    return c.json({ error: "Videos not allowed" }, 415);
  }

  // Size gate from the declared length (the stream is also bounded by the
  // 100 MB Workers request-body limit; this rejects early with a clear error).
  const sizeLimit = isVideo
    ? (event.video_max_bytes ?? VIDEO_CEILING_BYTES)
    : IMAGE_MAX_BYTES;
  if (contentLength > sizeLimit) {
    return c.json({ error: "Too large" }, 413);
  }

  const provider = getProvider(event.provider);
  const accessToken = await ensureValidToken(c.env.DB, c.env, event);

  const body = c.req.raw.body as ReadableStream<Uint8Array> | null;
  if (!body) return c.json({ error: "Empty body" }, 400);

  // Poster-attach branch: the client-generated JPEG poster for a video already
  // in the gallery. No dedup, no row, no notify — just upload and link it.
  const posterFor = c.req.header("X-Poster-For");
  if (posterFor) {
    const target = await getPhotoById(c.env.DB, posterFor);
    if (!target || target.event_id !== event.id) {
      return c.json({ error: "Unknown photo" }, 404);
    }
    if (!target.mime_type.startsWith("video/")) {
      return c.json({ error: "Not a video" }, 400);
    }
    const { fileRef } = await provider.streamUpload(
      accessToken,
      event.folder_id,
      `poster-${posterFor}.jpg`,
      "image/jpeg",
      body,
    );
    await setPhotoPoster(c.env.DB, event.id, posterFor, fileRef);
    return c.json({ ok: true });
  }

  const filename = decodeFilename(c.req.header("X-Filename"), "upload");
  const takenRaw = Number(c.req.header("X-Taken-At"));
  const takenAt =
    Number.isFinite(takenRaw) && takenRaw > 0 ? Math.floor(takenRaw) : null;
  const kind: FileKind = isVideo ? "video" : "image";

  try {
    // Stream the body to the provider and hash it in lockstep: one tee branch
    // feeds the hash, the other the upload. In production neither buffers the
    // file in the isolate (DigestStream); the dev Node runtime buffers the
    // hash branch only (see hashStreamToHex).
    const [toHash, toUpload] = body.tee();
    const hashP = hashStreamToHex(toHash);
    const uploadP = provider.streamUpload(
      accessToken,
      event.folder_id,
      filename,
      mime,
      toUpload,
    );
    const [{ fileRef }, { hex: hashHex, bytes }] = await Promise.all([
      uploadP,
      hashP,
    ]);

    // Dedup: a streamed upload commits the bytes before the hash is known, so
    // a duplicate is caught after upload — delete the redundant cloud copy
    // (best effort) and return the row that already holds these bytes.
    const existing = await getPhotoByHash(c.env.DB, event.id, hashHex);
    if (existing) {
      try {
        await provider.deleteFile(accessToken, fileRef);
      } catch {
        /* orphan cloud file; autorename already avoided a name clash */
      }
      return c.json({
        photo: {
          id: existing.id,
          username: guest.username,
          createdAt: existing.created_at,
          takenAt: existing.taken_at,
          kind: existing.mime_type.startsWith("video/") ? "video" : "image",
        } satisfies Item,
      });
    }

    const id = generateId(16);
    const createdAt = await addPhoto(c.env.DB, {
      id,
      event_id: event.id,
      guest_id: guest.id,
      file_ref: fileRef,
      filename,
      mime_type: mime,
      size_bytes: bytes,
      taken_at: takenAt,
      content_hash: hashHex,
      poster_ref: null,
    });
    c.executionCtx.waitUntil(notifyNewPhotos(c.env, event, 1, guest.username));
    return c.json({
      photo: {
        id,
        username: guest.username,
        createdAt,
        takenAt,
        kind,
      } satisfies Item,
    });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      500,
    );
  }
});
