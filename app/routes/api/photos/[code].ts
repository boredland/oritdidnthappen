import { createRoute } from "honox/factory";
import { getEventByCode, getPhotosPage, getPhotosSince } from "../../../lib/db";

export default createRoute(async (c) => {
  const code = c.req.param("code");
  if (!code) return c.json({ error: "Missing code" }, 400);
  const event = await getEventByCode(c.env.DB, code);
  if (!event) return c.json({ error: "Unknown event" }, 404);

  const now = Math.floor(Date.now() / 1000);
  const closed = event.expires_at != null && event.expires_at <= now;

  const sinceParam = c.req.query("since");

  // Incremental poll: only photos newer than `since`, oldest-first.
  if (sinceParam !== undefined) {
    const since = Number(sinceParam) || 0;
    const rows = await getPhotosSince(c.env.DB, event.id, since);
    return c.json({
      closed,
      photos: rows.map((p) => ({
        id: p.id,
        username: p.username,
        createdAt: p.created_at,
        takenAt: p.taken_at,
        kind: p.mime_type.startsWith("video/") ? "video" : "image",
      })),
    });
  }

  // Initial / paginated load, newest-first, via keyset cursor. `cursor` is
  // "<createdAt>_<id>" of the last row the client already has; absent = page 1.
  const limit = Math.min(Number(c.req.query("limit")) || 30, 100);
  const cursorParam = c.req.query("cursor");
  let cursor: { createdAt: number; id: string } | null = null;
  if (cursorParam) {
    const sep = cursorParam.lastIndexOf("_");
    if (sep > 0) {
      const createdAt = Number(cursorParam.slice(0, sep));
      const id = cursorParam.slice(sep + 1);
      if (Number.isFinite(createdAt) && id) cursor = { createdAt, id };
    }
  }
  const { photos, hasMore } = await getPhotosPage(
    c.env.DB,
    event.id,
    limit,
    cursor,
  );

  return c.json({
    closed,
    hasMore,
    photos: photos.map((p) => ({
      id: p.id,
      username: p.username,
      createdAt: p.created_at,
      takenAt: p.taken_at,
      kind: p.mime_type.startsWith("video/") ? "video" : "image",
    })),
  });
});
