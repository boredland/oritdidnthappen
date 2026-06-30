import { createRoute } from "honox/factory";
import {
  countPhotos,
  getEventByCode,
  getPhotosByEvent,
  getPhotosSince,
} from "../../../lib/db";

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
      })),
    });
  }

  // Initial / paginated load, newest-first.
  const limit = Math.min(Number(c.req.query("limit")) || 60, 100);
  const offset = Number(c.req.query("offset")) || 0;
  const [rows, total] = await Promise.all([
    getPhotosByEvent(c.env.DB, event.id, limit, offset),
    countPhotos(c.env.DB, event.id),
  ]);

  return c.json({
    closed,
    total,
    hasMore: offset + rows.length < total,
    photos: rows.map((p) => ({
      id: p.id,
      username: p.username,
      createdAt: p.created_at,
      takenAt: p.taken_at,
    })),
  });
});
