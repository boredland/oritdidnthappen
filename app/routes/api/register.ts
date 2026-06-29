import { createRoute } from "honox/factory";
import { generateId } from "../../lib/crypto";
import {
  createGuest,
  getEventByCode,
  isUsernameTaken,
} from "../../lib/db";
import { sanitizeUsername, uniqueUsername } from "../../lib/username";

export const POST = createRoute(async (c) => {
  const body = await c.req.json<{ eventCode?: string; desiredUsername?: string }>();
  const code = body.eventCode;
  if (!code) return c.json({ error: "Missing eventCode" }, 400);

  const event = await getEventByCode(c.env.DB, code);
  if (!event) return c.json({ error: "Unknown event" }, 404);

  const now = Math.floor(Date.now() / 1000);
  if (event.expires_at != null && event.expires_at <= now) {
    return c.json({ error: "Event is closed" }, 403);
  }

  let username: string;
  if (body.desiredUsername) {
    const clean = sanitizeUsername(body.desiredUsername);
    if (!clean) return c.json({ error: "Invalid username" }, 400);
    if (await isUsernameTaken(c.env.DB, event.id, clean)) {
      return c.json({ error: "Username taken" }, 409);
    }
    username = clean;
  } else {
    username = await uniqueUsername((name) =>
      isUsernameTaken(c.env.DB, event.id, name),
    );
  }

  const sessionToken = generateId(32);
  await createGuest(c.env.DB, {
    id: generateId(16),
    event_id: event.id,
    username,
    session_token: sessionToken,
  });

  return c.json({ username, sessionToken });
});
