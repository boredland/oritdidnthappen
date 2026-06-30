import { createRoute } from "honox/factory";
import { addPhoto, getEventByCode, getGuestBySession } from "../../../lib/db";
import { generateId } from "../../../lib/crypto";
import { ensureValidToken, getProvider } from "../../../lib/storage";
import { notifyNewPhotos } from "../../../lib/notify";

const ACCEPTED: Record<string, true> = {
  "image/jpeg": true,
  "image/png": true,
  "image/heic": true,
  "image/webp": true,
};
const MAX_BYTES = 25 * 1024 * 1024;

interface Uploaded {
  id: string;
  username: string;
  createdAt: number;
  takenAt: number | null;
}
interface UploadError {
  filename: string;
  reason: string;
}

export const POST = createRoute(async (c) => {
  const code = c.req.param("code");
  if (!code) return c.json({ error: "Missing code" }, 400);
  const auth = c.req.header("Authorization");
  const sessionToken = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!sessionToken) return c.json({ error: "Missing session" }, 401);

  const event = await getEventByCode(c.env.DB, code);
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
  const form = await c.req.parseBody({ all: true });
  const rawFiles = (() => {
    const v = form["file"];
    return Array.isArray(v) ? v : [v];
  })();
  // Optional EXIF capture time per file, sent by the client positionally
  // aligned with the file fields (empty string when the photo had no EXIF).
  const rawTaken = form["takenAt"];
  const takenList = Array.isArray(rawTaken) ? rawTaken : [rawTaken];
  // Keep files paired with their takenAt by zipping at the raw position,
  // before any filtering shifts indices.
  const entries = rawFiles.flatMap((f, i) =>
    f instanceof File ? [{ file: f, takenAt: takenList[i] }] : [],
  );
  if (entries.length === 0) return c.json({ error: "No files" }, 400);


  const provider = getProvider(event.provider);
  const accessToken = await ensureValidToken(c.env.DB, c.env, event);

  const uploaded: Uploaded[] = [];
  const errors: UploadError[] = [];
  for (const { file, takenAt: takenField } of entries) {
    if (!ACCEPTED[file.type]) {
      errors.push({ filename: file.name, reason: "Unsupported type" });
      continue;
    }
    if (file.size > MAX_BYTES) {
      errors.push({ filename: file.name, reason: "Too large" });
      continue;
    }
    try {
      const buffer = await file.arrayBuffer();
      const result = await provider.uploadFile(
        accessToken,
        event.folder_id,
        file.name,
        file.type,
        buffer,
      );
      const id = generateId(16);
      const takenRaw = Number(takenField);
      const takenAt =
        Number.isFinite(takenRaw) && takenRaw > 0 ? Math.floor(takenRaw) : null;
      const createdAt = await addPhoto(c.env.DB, {
        id,
        event_id: event.id,
        guest_id: guest.id,
        file_ref: result.fileRef,
        filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        taken_at: takenAt,
      });
      uploaded.push({ id, username: guest.username, createdAt, takenAt });
    } catch (e) {
      errors.push({
        filename: file.name,
        reason: e instanceof Error ? e.message : "Upload failed",
      });
    }
  }

  if (uploaded.length > 0) {
    c.executionCtx.waitUntil(
      notifyNewPhotos(c.env, event, uploaded.length, guest.username),
    );
  }

  return c.json({ uploaded, errors });
});
