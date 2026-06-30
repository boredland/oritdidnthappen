import { createRoute } from "honox/factory";
import { getEventCodesByEndpoint } from "../../../lib/db";

// GET /api/push/migrate?endpoint=… — event ids an endpoint is subscribed to,
// so the service worker can re-subscribe after a pushsubscriptionchange.
export default createRoute(async (c) => {
  const endpoint = c.req.query("endpoint");
  if (!endpoint) return c.json({ events: [] });
  return c.json({ events: await getEventCodesByEndpoint(c.env.DB, endpoint) });
});
