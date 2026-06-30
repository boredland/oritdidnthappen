import { createRoute } from "honox/factory";
import {
  deletePhoto,
  getEventByCode,
  getPhotoById,
  setCoverPhoto,
} from "../../../../lib/db";
import { ensureValidToken, getProvider } from "../../../../lib/storage";

export const POST = createRoute(async (c) => {
  const code = c.req.param("code");
  if (!code) return c.json({ error: "Missing code" }, 400);
  const body = await c.req.json<{ adminToken?: string; photoId?: string }>();

  const event = await getEventByCode(c.env.DB, code);
  if (!event) return c.json({ error: "Unknown event" }, 404);
  if (!body.adminToken || body.adminToken !== event.admin_token) {
    return c.json({ error: "Forbidden" }, 403);
  }
  if (!body.photoId) return c.json({ error: "Missing photoId" }, 400);

  const photo = await getPhotoById(c.env.DB, body.photoId);
  if (!photo || photo.event_id !== event.id) {
    return c.json({ error: "Unknown photo" }, 404);
  }

  // Best-effort delete from the host's cloud; never block the DB cleanup on it.
  try {
    const accessToken = await ensureValidToken(c.env.DB, c.env, event);
    await getProvider(event.provider).deleteFile(accessToken, photo.file_ref);
  } catch (e) {
    console.error("Cloud delete failed (continuing):", e);
  }

  await deletePhoto(c.env.DB, event.id, photo.id);
  if (event.cover_photo_id === photo.id) {
    await setCoverPhoto(c.env.DB, event.id, null);
  }

  return c.json({ deleted: photo.id });
});
