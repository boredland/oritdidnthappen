import { createRoute } from "honox/factory";
import { generateId } from "../../../lib/crypto";
import { addPushSubscription, getEventByCode } from "../../../lib/db";

interface Body {
  eventCode?: string;
  subscription?: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
}

// POST /api/push/subscribe — register a browser to be notified of new photos
// in one event. Anonymous: keyed only by the push endpoint.
export const POST = createRoute(async (c) => {
  const body = await c.req.json<Body>().catch(() => null);
  const code = body?.eventCode;
  const sub = body?.subscription;
  if (!code || !sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return c.json({ error: "Missing subscription" }, 400);
  }
  if (!sub.endpoint.startsWith("https://") || sub.endpoint.length > 2048) {
    return c.json({ error: "Invalid endpoint" }, 400);
  }

  const event = await getEventByCode(c.env.DB, code);
  if (!event) return c.json({ error: "Unknown event" }, 404);

  await addPushSubscription(c.env.DB, {
    id: generateId(16),
    event_id: event.id,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    user_agent: c.req.header("user-agent") ?? null,
  });

  return c.json({ ok: true });
});
