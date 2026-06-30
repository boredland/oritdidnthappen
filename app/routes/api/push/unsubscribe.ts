import { createRoute } from "honox/factory";
import {
  deleteSubscriptionByEndpoint,
  getEventByCode,
  removePushSubscription,
} from "../../../lib/db";

interface Body {
  eventCode?: string;
  endpoint?: string;
}

// POST /api/push/unsubscribe — drop the endpoint's subscription. Scoped to one
// event when eventCode is given; otherwise removes it from all events.
export const POST = createRoute(async (c) => {
  const body = await c.req.json<Body>().catch(() => null);
  if (!body?.endpoint) return c.json({ error: "endpoint required" }, 400);

  if (body.eventCode) {
    const event = await getEventByCode(c.env.DB, body.eventCode);
    if (event) {
      await removePushSubscription(c.env.DB, event.id, body.endpoint);
    }
  } else {
    await deleteSubscriptionByEndpoint(c.env.DB, body.endpoint);
  }
  return c.json({ ok: true });
});
