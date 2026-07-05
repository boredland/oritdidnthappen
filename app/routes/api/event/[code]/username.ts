import { createRoute } from "honox/factory";
import { hashToken } from "../../../../lib/crypto";
import {
  getEventByCode,
  getGuestBySessionHash,
  updateGuestUsername,
} from "../../../../lib/db";
import { verifyTurnstile } from "../../../../lib/turnstile";
import { sanitizeUsername } from "../../../../lib/username";

// POST /api/event/:code/username — rename the calling guest in place. Photos
// and guestbook entries join on guest_id, so every past contribution follows
// the new name (unlike re-registering, which orphaned the old guest's photos).
export const POST = createRoute(async (c) => {
  const code = c.req.param("code");
  if (!code) return c.json({ error: "Missing code" }, 400);

  const auth = c.req.header("Authorization");
  const sessionToken = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!sessionToken) return c.json({ error: "Missing session" }, 401);

  const body = await c.req.json<{
    username?: string;
    turnstileToken?: string;
  }>();

  const ip = c.req.header("CF-Connecting-IP") ?? null;
  const ok = await verifyTurnstile(
    body.turnstileToken,
    ip,
    c.env.TURNSTILE_SECRET_KEY,
  );
  if (!ok) return c.json({ error: "Verification failed" }, 403);

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

  const clean = sanitizeUsername(body.username ?? "");
  if (!clean) return c.json({ error: "Invalid username" }, 400);

  // No-op rename to the current name is a success, not a self-collision.
  if (clean === guest.username) return c.json({ username: clean });

  const renamed = await updateGuestUsername(
    c.env.DB,
    event.id,
    guest.id,
    clean,
  );
  if (!renamed) return c.json({ error: "Username taken" }, 409);

  return c.json({ username: clean });
});
