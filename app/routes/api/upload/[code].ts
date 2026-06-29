import { createRoute } from "honox/factory";
import { addPhoto, getEventByCode, getGuestBySession } from "../../../lib/db";
import { generateId } from "../../../lib/crypto";
import { ensureValidToken, getProvider } from "../../../lib/storage";

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
  const raw = form["file"];
  const files = (Array.isArray(raw) ? raw : [raw]).filter(
    (f): f is File => f instanceof File,
  );
  if (files.length === 0) return c.json({ error: "No files" }, 400);

  const provider = getProvider(event.provider);
  const accessToken = await ensureValidToken(c.env.DB, c.env, event);

  const uploaded: Uploaded[] = [];
  const errors: UploadError[] = [];

  for (const file of files) {
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
      const createdAt = await addPhoto(c.env.DB, {
        id,
        event_id: event.id,
        guest_id: guest.id,
        file_ref: result.fileRef,
        filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      });
      uploaded.push({ id, username: guest.username, createdAt });
    } catch (e) {
      errors.push({
        filename: file.name,
        reason: e instanceof Error ? e.message : "Upload failed",
      });
    }
  }

  return c.json({ uploaded, errors });
});
