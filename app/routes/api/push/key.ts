import { createRoute } from "honox/factory";

// GET /api/push/key — the event-agnostic VAPID public key for subscribing.
export default createRoute((c) => {
  if (!c.env.VAPID_PUBLIC_KEY) {
    return c.json({ error: "Push not configured" }, 503);
  }
  return c.json(
    { publicKey: c.env.VAPID_PUBLIC_KEY },
    200,
    { "Cache-Control": "public, max-age=3600" },
  );
});
