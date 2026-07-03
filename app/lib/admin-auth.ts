import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { hashToken, timingSafeEqual } from "./crypto";
import type { EventRow } from "./db";

/**
 * Admin authentication for a no-account app. The admin token is the sole bearer
 * credential, minted at the OAuth callback and delivered by the redirect + the
 * recovery email. Only its SHA-256 hash is ever persisted (`admin_token_hash`).
 *
 * The admin page exchanges a `?token=` for an HttpOnly cookie once, then every
 * later request — page loads and mutations alike — authorizes from that cookie.
 * The cookie holds the PLAINTEXT token, not the hash: each check hashes the
 * cookie and compares to the stored hash, so a stolen DB (hashes only) cannot
 * be forged into a valid cookie. `SameSite=Strict` is the CSRF defense the old
 * body-token provided; the tokened URL keeps working forever as recovery (it
 * just re-sets the cookie), so a cleared cookie never orphans an event.
 */

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function cookieName(eventId: string): string {
  return `admin_${eventId}`;
}

/**
 * Persist the admin credential (plaintext token) as an HttpOnly cookie. Scoped
 * to `/` (not the admin page path) because the mutation routes live under
 * `/api/event/...`, which shares no ancestor with `/event/.../admin` but the
 * root — a page-scoped cookie would never reach them. The cookie NAME is
 * event-specific, so a `/` scope only means an unrelated event's page won't see
 * this one's cookie.
 */
export function setAdminCookie(
  c: Context,
  eventId: string,
  token: string,
): void {
  setCookie(c, cookieName(eventId), token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

/**
 * True when the request carries a cookie whose token hashes to this event's
 * stored `admin_token_hash`, compared in constant time. An event with no hash
 * (not yet connected, or a pre-hash legacy row) can never be authorized.
 */
export async function hasAdminCookie(
  c: Context,
  event: EventRow,
): Promise<boolean> {
  if (event.admin_token_hash == null) return false;
  const token = getCookie(c, cookieName(event.id));
  if (token == null) return false;
  return timingSafeEqual(await hashToken(token), event.admin_token_hash);
}

/**
 * Authorize an admin mutation from the request cookie. The API routes send the
 * cookie automatically (same origin); `SameSite=Strict` blocks the cross-site
 * case.
 */
export function isAuthorizedAdmin(
  c: Context,
  event: EventRow,
): Promise<boolean> {
  return hasAdminCookie(c, event);
}
