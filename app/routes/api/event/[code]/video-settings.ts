import { createRoute } from "honox/factory";
import { getEventByCode, setEventVideoSettings } from "../../../../lib/db";
import { VIDEO_CEILING_BYTES, VIDEO_DEFAULT_BYTES } from "../../../../lib/upload";

export const POST = createRoute(async (c) => {
  const code = c.req.param("code");
  if (!code) return c.json({ error: "Missing code" }, 400);
  const body = await c.req.json<{
    adminToken?: string;
    enabled?: boolean;
    maxBytes?: number | null;
  }>();

  const event = await getEventByCode(c.env.DB, code);
  if (!event) return c.json({ error: "Unknown event" }, 404);
  if (!body.adminToken || body.adminToken !== event.admin_token) {
    return c.json({ error: "Forbidden" }, 403);
  }

  // Off → clear the limit. On → require a positive integer, default when
  // missing/invalid, clamp to the hard ceiling so the upload gate agrees.
  let maxBytes: number | null = null;
  if (body.enabled) {
    const raw = body.maxBytes;
    const valid = typeof raw === "number" && Number.isFinite(raw) && raw > 0;
    maxBytes = Math.min(valid ? Math.floor(raw) : VIDEO_DEFAULT_BYTES, VIDEO_CEILING_BYTES);
  }

  await setEventVideoSettings(c.env.DB, event.id, body.enabled === true, maxBytes);
  return c.json({ enabled: body.enabled === true, maxBytes });
});
