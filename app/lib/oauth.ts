import type { Context } from "hono";
import { encryptToken } from "./crypto";
import type { Provider } from "./db";
import { getEventByCode, setEventStorage } from "./db";
import { sendAdminLink } from "./email";
import { getProvider } from "./storage";

/**
 * Shared OAuth callback: exchange the code, encrypt + persist tokens, create
 * the destination folder, optionally email the admin link, then redirect the
 * host to their admin dashboard. `state` carries the event id we created
 * before sending the host to the provider.
 */
export async function handleOAuthCallback(
  c: Context,
  provider: Provider,
): Promise<Response> {
  const code = c.req.query("code");
  const eventId = c.req.query("state");
  const error = c.req.query("error");

  if (error || !code || !eventId) {
    return c.redirect(`/create?error=auth_failed`);
  }

  const event = await getEventByCode(c.env.DB, eventId);
  if (!event || event.provider !== provider) {
    return c.redirect(`/create?error=unknown_event`);
  }

  const sp = getProvider(provider);
  try {
    const tokens = await sp.exchangeCode(c.env, code);
    const folder = await sp.createFolder(
      tokens.accessToken,
      event.folder_name ?? `or it didn't happen — ${event.title}`,
    );

    const encAccess = await encryptToken(
      tokens.accessToken,
      c.env.ENCRYPTION_KEY,
    );
    const encRefresh = tokens.refreshToken
      ? await encryptToken(tokens.refreshToken, c.env.ENCRYPTION_KEY)
      : null;
    const tokenExpiry = tokens.expiresIn
      ? Date.now() + tokens.expiresIn * 1000
      : null;

    await setEventStorage(c.env.DB, event.id, {
      access_token: encAccess,
      refresh_token: encRefresh,
      token_expiry: tokenExpiry,
      folder_id: folder.folderId,
      folder_url: folder.folderUrl,
    });
  } catch (e) {
    console.error("OAuth callback failed:", e);
    return c.redirect(`/create?error=connect_failed`);
  }

  const adminUrl = `${c.env.BASE_URL}/event/${event.id}/admin?token=${event.admin_token}`;
  if (event.host_email) {
    await sendAdminLink(c.env, event.host_email, event.title, adminUrl);
  }

  return c.redirect(
    `/event/${event.id}/admin?token=${event.admin_token}&new=1`,
  );
}
