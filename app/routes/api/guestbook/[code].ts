import { createRoute } from "honox/factory";
import { generateId, hashToken } from "../../../lib/crypto";
import {
  addGuestbookEntry,
  getEventByCode,
  getGuestBySessionHash,
  getGuestbookEntries,
} from "../../../lib/db";
import { sanitizeGuestbookBody } from "../../../lib/guestbook";
import { notifyNewGuestbookEntry } from "../../../lib/notify";

interface EntryOut {
  id: string;
  username: string;
  body: string;
  createdAt: number;
}

// GET /api/guestbook/:code — an event's guestbook, newest-first.
export default createRoute(async (c) => {
  const code = c.req.param("code");
  if (!code) return c.json({ error: "Missing code" }, 400);
  const event = await getEventByCode(c.env.DB, code);
  if (!event) return c.json({ error: "Unknown event" }, 404);

  const rows = await getGuestbookEntries(c.env.DB, event.id);
  return c.json({
    entries: rows.map(
      (e) =>
        ({
          id: e.id,
          username: e.username,
          body: e.body,
          createdAt: e.created_at,
        }) satisfies EntryOut,
    ),
  });
});

// POST /api/guestbook/:code — sign the guestbook as the calling guest.
export const POST = createRoute(async (c) => {
  const code = c.req.param("code");
  if (!code) return c.json({ error: "Missing code" }, 400);

  const auth = c.req.header("Authorization");
  const sessionToken = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!sessionToken) return c.json({ error: "Missing session" }, 401);

  const body = await c.req.json<{ body?: string }>();

  const event = await getEventByCode(c.env.DB, code);
  if (!event) return c.json({ error: "Unknown event" }, 404);

  const now = Math.floor(Date.now() / 1000);
  if (event.expires_at != null && event.expires_at <= now) {
    return c.json({ error: "Event is closed" }, 403);
  }

  const guest = await getGuestBySessionHash(
    c.env.DB,
    event.id,
    await hashToken(sessionToken),
  );
  if (!guest) return c.json({ error: "Invalid session" }, 401);

  const clean = sanitizeGuestbookBody(body.body ?? "");
  if (!clean) return c.json({ error: "Invalid message" }, 400);

  const id = generateId(16);
  const createdAt = await addGuestbookEntry(c.env.DB, {
    id,
    event_id: event.id,
    guest_id: guest.id,
    body: clean,
  });

  c.executionCtx.waitUntil(
    notifyNewGuestbookEntry(c.env, event, guest.username),
  );

  return c.json({
    entry: {
      id,
      username: guest.username,
      body: clean,
      createdAt,
    } satisfies EntryOut,
  });
});
