export type Provider = "google_drive" | "dropbox";

export interface EventRow {
  id: string;
  title: string;
  host_email: string | null;
  admin_token_hash: string | null;
  provider: Provider;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: number | null;
  folder_id: string | null;
  folder_url: string | null;
  created_at: number;
  expires_at: number | null;
  cover_photo_id: string | null;
  folder_name: string | null;
  videos_enabled: number;
  video_max_bytes: number | null;
}

export interface GuestRow {
  id: string;
  event_id: string;
  username: string;
  session_token_hash: string;
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
  taken_at: number | null;
  content_hash: string | null;
  poster_ref: string | null;
}

export interface PhotoWithUser extends PhotoRow {
  username: string;
}

export interface NewEvent {
  id: string;
  title: string;
  host_email: string | null;
  provider: Provider;
  folder_name: string;
}

export async function createEvent(db: D1Database, e: NewEvent): Promise<void> {
  await db
    .prepare(
      `INSERT INTO events (id, title, host_email, provider, folder_name)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(e.id, e.title, e.host_email, e.provider, e.folder_name)
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

/** Store the admin token's hash after the OAuth callback mints the token. */
export async function setEventAdminTokenHash(
  db: D1Database,
  id: string,
  adminTokenHash: string,
): Promise<void> {
  await db
    .prepare(`UPDATE events SET admin_token_hash = ? WHERE id = ?`)
    .bind(adminTokenHash, id)
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
    .prepare(
      `UPDATE events SET access_token = ?, token_expiry = ? WHERE id = ?`,
    )
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

export async function setEventVideoSettings(
  db: D1Database,
  id: string,
  enabled: boolean,
  maxBytes: number | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE events SET videos_enabled = ?, video_max_bytes = ? WHERE id = ?`,
    )
    .bind(enabled ? 1 : 0, maxBytes, id)
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

/**
 * Insert a guest, returning false when the `(event_id, username)` pair is
 * already taken. `ON CONFLICT DO NOTHING` makes this atomic: two guests racing
 * for the same name can't both win, and the loser gets a clean false instead
 * of a thrown UNIQUE-constraint error.
 */
export async function createGuest(
  db: D1Database,
  g: {
    id: string;
    event_id: string;
    username: string;
    session_token_hash: string;
  },
): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO guests (id, event_id, username, session_token_hash)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(event_id, username) DO NOTHING`,
    )
    .bind(g.id, g.event_id, g.username, g.session_token_hash)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function getGuestBySessionHash(
  db: D1Database,
  eventId: string,
  sessionTokenHash: string,
): Promise<GuestRow | null> {
  return db
    .prepare(
      `SELECT * FROM guests WHERE event_id = ? AND session_token_hash = ?`,
    )
    .bind(eventId, sessionTokenHash)
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

/**
 * Rename a guest in place. Because photos and guestbook entries join on
 * guest_id, every past contribution follows the new name. Returns false when
 * the new username collides with another guest in the same event.
 */
export async function updateGuestUsername(
  db: D1Database,
  eventId: string,
  guestId: string,
  username: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE guests SET username = ?
       WHERE id = ? AND event_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM guests
         WHERE event_id = ? AND username = ? AND id != ?
       )`,
    )
    .bind(username, guestId, eventId, eventId, username, guestId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export interface GuestbookEntry {
  id: string;
  event_id: string;
  guest_id: string;
  body: string;
  created_at: number;
  username: string;
}

export async function addGuestbookEntry(
  db: D1Database,
  e: {
    id: string;
    event_id: string;
    guest_id: string;
    body: string;
  },
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO guestbook (id, event_id, guest_id, body)
       VALUES (?, ?, ?, ?)
       RETURNING created_at`,
    )
    .bind(e.id, e.event_id, e.guest_id, e.body)
    .first<{ created_at: number }>();
  return row?.created_at ?? Math.floor(Date.now() / 1000);
}

/** An event's guestbook entries, newest-first, with the author's current name. */
export async function getGuestbookEntries(
  db: D1Database,
  eventId: string,
  limit = 100,
): Promise<GuestbookEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT b.*, g.username
       FROM guestbook b JOIN guests g ON g.id = b.guest_id
       WHERE b.event_id = ?
       ORDER BY b.created_at DESC, b.id DESC
       LIMIT ?`,
    )
    .bind(eventId, limit)
    .all<GuestbookEntry>();
  return results ?? [];
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
    taken_at: number | null;
    content_hash: string;
    poster_ref: string | null;
  },
): Promise<number | null> {
  // ON CONFLICT against the partial unique index (event_id, content_hash)
  // makes dedup atomic: a concurrent identical upload can't insert a second
  // row. On conflict no row is inserted and RETURNING yields nothing, so a
  // null result tells the caller "a duplicate already won — go read it".
  const row = await db
    .prepare(
      `INSERT INTO photos
         (id, event_id, guest_id, file_ref, filename, mime_type, size_bytes, taken_at, content_hash, poster_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, content_hash) WHERE content_hash IS NOT NULL DO NOTHING
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
      p.taken_at,
      p.content_hash,
      p.poster_ref,
    )
    .first<{ created_at: number }>();
  return row?.created_at ?? null;
}

/**
 * Find a photo in this event by its content hash, for deduplication. Returns
 * the existing row when an identical file is already in the gallery.
 */
export async function getPhotoByHash(
  db: D1Database,
  eventId: string,
  contentHash: string,
): Promise<PhotoRow | null> {
  return db
    .prepare(`SELECT * FROM photos WHERE event_id = ? AND content_hash = ?`)
    .bind(eventId, contentHash)
    .first<PhotoRow>();
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

/** Attach the client-generated poster's cloud file_ref to a video row. */
export async function setPhotoPoster(
  db: D1Database,
  eventId: string,
  photoId: string,
  posterRef: string,
): Promise<void> {
  await db
    .prepare(`UPDATE photos SET poster_ref = ? WHERE id = ? AND event_id = ?`)
    .bind(posterRef, photoId, eventId)
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

/**
 * One page of an event's photos, newest-first, using a keyset cursor instead
 * of OFFSET so concurrent inserts (guests uploading while others scroll) never
 * shift the window and cause skipped or duplicated rows. `cursor` is the last
 * row already seen; pass null for the first page. Fetches `limit + 1` to tell
 * the caller whether more remain without a separate COUNT.
 */
export async function getPhotosPage(
  db: D1Database,
  eventId: string,
  limit: number,
  cursor: { createdAt: number; id: string } | null,
): Promise<{ photos: PhotoWithUser[]; hasMore: boolean }> {
  const base = `SELECT p.*, g.username
       FROM photos p JOIN guests g ON g.id = p.guest_id
       WHERE p.event_id = ?`;
  const order = `ORDER BY p.created_at DESC, p.id DESC LIMIT ?`;
  const stmt = cursor
    ? db
        .prepare(
          `${base} AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?)) ${order}`,
        )
        .bind(eventId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
    : db.prepare(`${base} ${order}`).bind(eventId, limit + 1);
  const { results } = await stmt.all<PhotoWithUser>();
  const rows = results ?? [];
  const hasMore = rows.length > limit;
  return { photos: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

/**
 * Photos created at or after `since` (unix seconds), oldest-first. Inclusive
 * (`>=`) so a same-second upload by another guest at the cursor isn't missed;
 * the client dedups by id, so re-returning the cursor row is harmless.
 */
export async function getPhotosSince(
  db: D1Database,
  eventId: string,
  since: number,
): Promise<PhotoWithUser[]> {
  const { results } = await db
    .prepare(
      `SELECT p.*, g.username
       FROM photos p JOIN guests g ON g.id = p.guest_id
       WHERE p.event_id = ? AND p.created_at >= ?
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
    .prepare(
      `DELETE FROM push_subscriptions WHERE event_id = ? AND endpoint = ?`,
    )
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
    .prepare(
      `SELECT 1 FROM push_subscriptions WHERE event_id = ? AND endpoint = ?`,
    )
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
  await db
    .prepare(`DELETE FROM push_subscriptions WHERE id = ?`)
    .bind(id)
    .run();
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

/** All cloud file references for an event's photos (for best-effort cleanup). */
export async function getEventFileRefs(
  db: D1Database,
  eventId: string,
): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT file_ref FROM photos WHERE event_id = ?`)
    .bind(eventId)
    .all<{ file_ref: string }>();
  return (results ?? []).map((r) => r.file_ref);
}

/**
 * Delete an event and every row that references it. D1 has no FK cascade, so
 * children are removed first, then the event — atomically via a batch.
 */
export async function deleteEvent(
  db: D1Database,
  eventId: string,
): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM photos WHERE event_id = ?`).bind(eventId),
    db
      .prepare(`DELETE FROM push_subscriptions WHERE event_id = ?`)
      .bind(eventId),
    db.prepare(`DELETE FROM guestbook WHERE event_id = ?`).bind(eventId),
    db.prepare(`DELETE FROM guests WHERE event_id = ?`).bind(eventId),
    db.prepare(`DELETE FROM events WHERE id = ?`).bind(eventId),
  ]);
}

/**
 * Event ids past their retention window: closed at least `closedGraceSecs` ago,
 * OR created at least `maxAgeSecs` ago regardless of state (bounds token
 * lifetime for events a host connected but abandoned). `now` is unix seconds.
 */
export async function getExpiredEventIds(
  db: D1Database,
  now: number,
  closedGraceSecs: number,
  maxAgeSecs: number,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT id FROM events
       WHERE (expires_at IS NOT NULL AND expires_at <= ?)
          OR created_at <= ?`,
    )
    .bind(now - closedGraceSecs, now - maxAgeSecs)
    .all<{ id: string }>();
  return (results ?? []).map((r) => r.id);
}

/**
 * Delete many events and all their child rows in one batch. Children first
 * (D1 has no FK cascade), events last. No-op on an empty list.
 */
export async function deleteEvents(
  db: D1Database,
  eventIds: string[],
): Promise<void> {
  if (eventIds.length === 0) return;
  const placeholders = eventIds.map(() => "?").join(", ");
  await db.batch([
    db
      .prepare(`DELETE FROM photos WHERE event_id IN (${placeholders})`)
      .bind(...eventIds),
    db
      .prepare(
        `DELETE FROM push_subscriptions WHERE event_id IN (${placeholders})`,
      )
      .bind(...eventIds),
    db
      .prepare(`DELETE FROM guestbook WHERE event_id IN (${placeholders})`)
      .bind(...eventIds),
    db
      .prepare(`DELETE FROM guests WHERE event_id IN (${placeholders})`)
      .bind(...eventIds),
    db
      .prepare(`DELETE FROM events WHERE id IN (${placeholders})`)
      .bind(...eventIds),
  ]);
}
