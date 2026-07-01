import { createRoute } from "honox/factory";
import {
  getEventByCode,
  getPhotoById,
  setCoverPhoto,
} from "../../../../lib/db";

export const POST = createRoute(async (c) => {
  const code = c.req.param("code");
  if (!code) return c.json({ error: "Missing code" }, 400);
  // photoId null clears the cover.
  const body = await c.req.json<{
    adminToken?: string;
    photoId?: string | null;
  }>();

  const event = await getEventByCode(c.env.DB, code);
  if (!event) return c.json({ error: "Unknown event" }, 404);
  if (!body.adminToken || body.adminToken !== event.admin_token) {
    return c.json({ error: "Forbidden" }, 403);
  }

  if (body.photoId) {
    const photo = await getPhotoById(c.env.DB, body.photoId);
    if (!photo || photo.event_id !== event.id) {
      return c.json({ error: "Unknown photo" }, 404);
    }
  }

  await setCoverPhoto(c.env.DB, event.id, body.photoId ?? null);
  return c.json({ cover: body.photoId ?? null });
});
