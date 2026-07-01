import { createRoute } from "honox/factory";
import {
  deleteEvent,
  getEventByCode,
  getEventFileRefs,
} from "../../../../lib/db";
import { ensureValidToken, getProvider } from "../../../../lib/storage";

export const POST = createRoute(async (c) => {
  const code = c.req.param("code");
  if (!code) return c.json({ error: "Missing code" }, 400);
  const body = await c.req.json<{ adminToken?: string }>();

  const event = await getEventByCode(c.env.DB, code);
  if (!event) return c.json({ error: "Unknown event" }, 404);
  if (!body.adminToken || body.adminToken !== event.admin_token) {
    return c.json({ error: "Forbidden" }, 403);
  }

  // Best-effort: remove each uploaded photo from the host's cloud. The folder
  // itself is left in place — we never delete anything in the host's Drive
  // beyond the files this app put there. Token/provider failures must not
  // block the DB cleanup, so the event can always be removed.
  try {
    const refs = await getEventFileRefs(c.env.DB, event.id);
    if (refs.length > 0 && event.folder_id) {
      const accessToken = await ensureValidToken(c.env.DB, c.env, event);
      const provider = getProvider(event.provider);
      await Promise.allSettled(
        refs.map((ref) => provider.deleteFile(accessToken, ref)),
      );
    }
  } catch (e) {
    console.error("Cloud cleanup failed (continuing with DB delete):", e);
  }

  await deleteEvent(c.env.DB, event.id);
  return c.json({ deleted: true });
});
