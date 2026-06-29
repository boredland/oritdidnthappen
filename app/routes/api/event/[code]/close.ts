import { createRoute } from "honox/factory";
import { getEventByCode, setEventExpiry } from "../../../../lib/db";

export const POST = createRoute(async (c) => {
  const code = c.req.param("code");
  if (!code) return c.json({ error: "Missing code" }, 400);
  const body = await c.req.json<{ adminToken?: string; closed?: boolean }>();

  const event = await getEventByCode(c.env.DB, code);
  if (!event) return c.json({ error: "Unknown event" }, 404);
  if (!body.adminToken || body.adminToken !== event.admin_token) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const expiresAt = body.closed ? Math.floor(Date.now() / 1000) : null;
  await setEventExpiry(c.env.DB, event.id, expiresAt);
  return c.json({ closed: body.closed === true });
});
