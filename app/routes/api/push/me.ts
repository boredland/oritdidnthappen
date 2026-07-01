import { createRoute } from "honox/factory";
import { getEventByCode, isSubscribed } from "../../../lib/db";

// GET /api/push/me?eventCode=…&endpoint=… — is this browser subscribed to this
// event's new-photo notifications?
export default createRoute(async (c) => {
  const code = c.req.query("eventCode");
  const endpoint = c.req.query("endpoint");
  if (!code || !endpoint) return c.json({ subscribed: false });

  const event = await getEventByCode(c.env.DB, code);
  if (!event) return c.json({ subscribed: false });

  return c.json({
    subscribed: await isSubscribed(c.env.DB, event.id, endpoint),
  });
});
