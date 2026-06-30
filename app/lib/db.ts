export type Provider = "google_drive" | "dropbox";

export interface EventRow {
  id: string;
  title: string;
  host_email: string | null;
  admin_token: string;
  provider: Provider;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: number | null;
  folder_id: string | null;
  folder_url: string | null;
  created_at: number;
  expires_at: number | null;
  cover_photo_id: string | null;
}

export interface GuestRow {
  id: string;
  event_id: string;
  username: string;
  session_token: string;
  created_at: number;
}

export interface PhotoRow {
  id: string;
  event_id: string;
  guest_id: string;
  file_ref: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: number;
}

export interface PhotoWithUser extends PhotoRow {
  username: string;
}

export interface NewEvent {
  id: string;
  title: string;
  host_email: string | null;
  admin_token: string;
  provider: Provider;
}

export async function createEvent(db: D1Database, e: NewEvent): Promise<void> {
  await db
    .prepare(
      `INSERT INTO events (id, title, host_email, admin_token, provider)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(e.id, e.title, e.host_email, e.admin_token, e.provider)
    .run();
}

export async function getEventByCode(
  db: D1Database,
  code: string,
): Promise<EventRow | null> {
  return db
    .prepare(`SELECT * FROM events WHERE id = ?`)
    .bind(code)
    .first<EventRow>();
}

export async function getEventByAdminToken(
  db: D1Database,
  token: string,
): Promise<EventRow | null> {
  return db
    .prepare(`SELECT * FROM events WHERE admin_token = ?`)
    .bind(token)
    .first<EventRow>();
}

/** Persist OAuth tokens + destination folder after a provider connects. */
export async function setEventStorage(
  db: D1Database,
  id: string,
  data: {
    access_token: string;
    refresh_token: string | null;
    token_expiry: number | null;
    folder_id: string;
    folder_url: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE events
       SET access_token = ?, refresh_token = ?, token_expiry = ?,
           folder_id = ?, folder_url = ?
       WHERE id = ?`,
    )
    .bind(
      data.access_token,
      data.refresh_token,
      data.token_expiry,
      data.folder_id,
      data.folder_url,
      id,
    )
    .run();
}

/** Update only the access token + expiry after a refresh. */
export async function updateEventAccessToken(
  db: D1Database,
  id: string,
  accessToken: string,
  tokenExpiry: number,
): Promise<void> {
  await db
    .prepare(`UPDATE events SET access_token = ?, token_expiry = ? WHERE id = ?`)
    .bind(accessToken, tokenExpiry, id)
    .run();
}

export async function setEventExpiry(
  db: D1Database,
  id: string,
  expiresAt: number | null,
): Promise<void> {
  await db
    .prepare(`UPDATE events SET expires_at = ? WHERE id = ?`)
    .bind(expiresAt, id)
    .run();
}

export async function isUsernameTaken(
  db: D1Database,
  eventId: string,
  username: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM guests WHERE event_id = ? AND username = ?`)
    .bind(eventId, username)
    .first();
  return row !== null;
}

export async function createGuest(
  db: D1Database,
  g: { id: string; event_id: string; username: string; session_token: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO guests (id, event_id, username, session_token)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(g.id, g.event_id, g.username, g.session_token)
    .run();
}

export async function getGuestBySession(
  db: D1Database,
  eventId: string,
  sessionToken: string,
): Promise<GuestRow | null> {
  return db
    .prepare(`SELECT * FROM guests WHERE event_id = ? AND session_token = ?`)
    .bind(eventId, sessionToken)
    .first<GuestRow>();
}

export async function countGuests(
  db: D1Database,
  eventId: string,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM guests WHERE event_id = ?`)
    .bind(eventId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function addPhoto(
  db: D1Database,
  p: {
    id: string;
    event_id: string;
    guest_id: string;
    file_ref: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
  },
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO photos
         (id, event_id, guest_id, file_ref, filename, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING created_at`,
    )
    .bind(
      p.id,
      p.event_id,
      p.guest_id,
      p.file_ref,
      p.filename,
      p.mime_type,
      p.size_bytes,
    )
    .first<{ created_at: number }>();
  return row?.created_at ?? Math.floor(Date.now() / 1000);
}

export async function getPhotoById(
  db: D1Database,
  photoId: string,
): Promise<PhotoRow | null> {
  return db
    .prepare(`SELECT * FROM photos WHERE id = ?`)
    .bind(photoId)
    .first<PhotoRow>();
}

/** Delete a photo row, scoped to its event. Returns true if a row was removed. */
export async function deletePhoto(
  db: D1Database,
  eventId: string,
  photoId: string,
): Promise<boolean> {
  const res = await db
    .prepare(`DELETE FROM photos WHERE id = ? AND event_id = ?`)
    .bind(photoId, eventId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Set (or clear, with null) the event's cover photo. */
export async function setCoverPhoto(
  db: D1Database,
  eventId: string,
  photoId: string | null,
): Promise<void> {
  await db
    .prepare(`UPDATE events SET cover_photo_id = ? WHERE id = ?`)
    .bind(photoId, eventId)
    .run();
}

export async function getPhotosByEvent(
  db: D1Database,
  eventId: string,
  limit: number,
  offset: number,
): Promise<PhotoWithUser[]> {
  const { results } = await db
    .prepare(
      `SELECT p.*, g.username
       FROM photos p JOIN guests g ON g.id = p.guest_id
       WHERE p.event_id = ?
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(eventId, limit, offset)
    .all<PhotoWithUser>();
  return results ?? [];
}

/** Photos created strictly after `since` (unix seconds), oldest-first. */
export async function getPhotosSince(
  db: D1Database,
  eventId: string,
  since: number,
): Promise<PhotoWithUser[]> {
  const { results } = await db
    .prepare(
      `SELECT p.*, g.username
       FROM photos p JOIN guests g ON g.id = p.guest_id
       WHERE p.event_id = ? AND p.created_at > ?
       ORDER BY p.created_at ASC, p.id ASC
       LIMIT 200`,
    )
    .bind(eventId, since)
    .all<PhotoWithUser>();
  return results ?? [];
}

export async function countPhotos(
  db: D1Database,
  eventId: string,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM photos WHERE event_id = ?`)
    .bind(eventId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface PushSubRow {
  id: string;
  event_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function addPushSubscription(
  db: D1Database,
  s: {
    id: string;
    event_id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    user_agent: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_subscriptions
         (id, event_id, endpoint, p256dh, auth, user_agent)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (event_id, endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent`,
    )
    .bind(s.id, s.event_id, s.endpoint, s.p256dh, s.auth, s.user_agent)
    .run();
}

export async function removePushSubscription(
  db: D1Database,
  eventId: string,
  endpoint: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM push_subscriptions WHERE event_id = ? AND endpoint = ?`)
    .bind(eventId, endpoint)
    .run();
}

export async function deleteSubscriptionByEndpoint(
  db: D1Database,
  endpoint: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`)
    .bind(endpoint)
    .run();
}

export async function isSubscribed(
  db: D1Database,
  eventId: string,
  endpoint: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM push_subscriptions WHERE event_id = ? AND endpoint = ?`)
    .bind(eventId, endpoint)
    .first();
  return row !== null;
}

export async function getEventSubscriptions(
  db: D1Database,
  eventId: string,
): Promise<PushSubRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, event_id, endpoint, p256dh, auth
       FROM push_subscriptions WHERE event_id = ?`,
    )
    .bind(eventId)
    .all<PushSubRow>();
  return results ?? [];
}

export async function deleteSubscriptionById(
  db: D1Database,
  id: string,
): Promise<void> {
  await db.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).bind(id).run();
}

/** Event ids an endpoint is currently subscribed to (for SW re-subscription). */
export async function getEventCodesByEndpoint(
  db: D1Database,
  endpoint: string,
): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT event_id FROM push_subscriptions WHERE endpoint = ?`)
    .bind(endpoint)
    .all<{ event_id: string }>();
  return (results ?? []).map((r) => r.event_id);
}
