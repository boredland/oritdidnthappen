import { createRoute } from "honox/factory";
import { generateId } from "../../lib/crypto";
import { createGuest, getEventByCode, isUsernameTaken } from "../../lib/db";
import { verifyTurnstile } from "../../lib/turnstile";
import { sanitizeUsername, uniqueUsername } from "../../lib/username";

export const POST = createRoute(async (c) => {
  const body = await c.req.json<{
    eventCode?: string;
    desiredUsername?: string;
    turnstileToken?: string;
  }>();
  const code = body.eventCode;
  if (!code) return c.json({ error: "Missing eventCode" }, 400);

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

  const sessionToken = generateId(32);
  if (body.desiredUsername) {
    const clean = sanitizeUsername(body.desiredUsername);
    if (!clean) return c.json({ error: "Invalid username" }, 400);
    const inserted = await createGuest(c.env.DB, {
      id: generateId(16),
      event_id: event.id,
      username: clean,
      session_token: sessionToken,
    });
    // A conflict (checked-taken OR a concurrent claim of the same name losing
    // the race) resolves to a clean 409, never a leaked constraint 500.
    if (!inserted) return c.json({ error: "Username taken" }, 409);
    return c.json({ username: clean, sessionToken });
  }

  // Auto-assigned name: uniqueUsername probes for a free candidate, but the
  // INSERT is the authority. Retry on the rare race where a probed-free name
  // is claimed concurrently before our insert lands.
  for (let attempt = 0; attempt < 5; attempt++) {
    const username = await uniqueUsername((name) =>
      isUsernameTaken(c.env.DB, event.id, name),
    );
    const inserted = await createGuest(c.env.DB, {
      id: generateId(16),
      event_id: event.id,
      username,
      session_token: sessionToken,
    });
    if (inserted) return c.json({ username, sessionToken });
  }
  return c.json({ error: "Could not assign a username" }, 409);
});
