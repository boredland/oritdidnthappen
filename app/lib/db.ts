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
