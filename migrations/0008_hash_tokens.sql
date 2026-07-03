-- Store bearer tokens as one-way SHA-256 hashes instead of plaintext, so a DB
-- dump alone cannot be replayed against the live app. (The OAuth access/refresh
-- tokens that unlock cloud storage were already AES-256-GCM encrypted.)
--
-- This also makes events.admin_token_hash NULLABLE — the admin token is now
-- minted at the OAuth callback, so an event exists tokenless between /create and
-- connect. SQLite can't drop a NOT NULL/UNIQUE constraint via ALTER, so the
-- table is recreated.
--
-- The obstacle: guests/photos/push_subscriptions REFERENCE events(id), and on
-- D1 `DROP TABLE events` does an implicit row-delete that trips those FKs even
-- with defer_foreign_keys (which D1 doesn't honor across a parent drop). These
-- FKs are vestigial here — deletes are already done children-first in code
-- (see deleteEvent), there is no cascade to lose. So every table is recreated
-- WITHOUT the inbound event FKs, children dropped before events, and no drop
-- ever faces a referencing row. Data is preserved by copy. Existing plaintext
-- admin tokens can't be re-hashed in SQL (no SHA-256 in SQLite): they migrate
-- to NULL, so those hosts must re-open their original admin link — acceptable
-- pre-launch, and that plaintext was exactly the exposure being removed.

-- New shapes (no REFERENCES clauses; every column + default reproduced).
CREATE TABLE events_new (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  host_email       TEXT,
  admin_token_hash TEXT,
  provider         TEXT NOT NULL DEFAULT 'google_drive',
  access_token     TEXT,
  refresh_token    TEXT,
  token_expiry     INTEGER,
  folder_id        TEXT,
  folder_url       TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at       INTEGER,
  cover_photo_id   TEXT,
  folder_name      TEXT,
  videos_enabled   INTEGER NOT NULL DEFAULT 0,
  video_max_bytes  INTEGER
);

CREATE TABLE guests_new (
  id                 TEXT PRIMARY KEY,
  event_id           TEXT NOT NULL,
  username           TEXT NOT NULL,
  session_token_hash TEXT NOT NULL UNIQUE,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(event_id, username)
);

CREATE TABLE photos_new (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL,
  guest_id     TEXT NOT NULL,
  file_ref     TEXT NOT NULL,
  filename     TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  taken_at     INTEGER,
  content_hash TEXT,
  poster_ref   TEXT
);

CREATE TABLE push_subscriptions_new (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(event_id, endpoint)
);

-- Copy data. admin_token -> NULL (can't re-hash in SQL); session_token ->
-- session_token_hash (the value is already a hash for rows written by the new
-- code; legacy plaintext sessions simply stop matching, which is fine).
INSERT INTO events_new
  (id, title, host_email, admin_token_hash, provider, access_token,
   refresh_token, token_expiry, folder_id, folder_url, created_at, expires_at,
   cover_photo_id, folder_name, videos_enabled, video_max_bytes)
SELECT
   id, title, host_email, NULL, provider, access_token,
   refresh_token, token_expiry, folder_id, folder_url, created_at, expires_at,
   cover_photo_id, folder_name, videos_enabled, video_max_bytes
FROM events;

INSERT INTO guests_new
  (id, event_id, username, session_token_hash, created_at)
SELECT id, event_id, username, session_token, created_at FROM guests;

INSERT INTO photos_new
  (id, event_id, guest_id, file_ref, filename, mime_type, size_bytes,
   created_at, taken_at, content_hash, poster_ref)
SELECT id, event_id, guest_id, file_ref, filename, mime_type, size_bytes,
   created_at, taken_at, content_hash, poster_ref FROM photos;

INSERT INTO push_subscriptions_new
  (id, event_id, endpoint, p256dh, auth, user_agent, created_at)
SELECT id, event_id, endpoint, p256dh, auth, user_agent, created_at
FROM push_subscriptions;

-- Drop old tables children-first so no drop faces a referencing row.
DROP TABLE photos;
DROP TABLE push_subscriptions;
DROP TABLE guests;
DROP TABLE events;

ALTER TABLE events_new RENAME TO events;
ALTER TABLE guests_new RENAME TO guests;
ALTER TABLE photos_new RENAME TO photos;
ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions;

-- Recreate every index from 0001/0003/0005/0006.
CREATE INDEX idx_photos_event ON photos(event_id, created_at DESC);
CREATE INDEX idx_guests_event ON guests(event_id);
CREATE INDEX idx_push_event ON push_subscriptions(event_id);
CREATE INDEX idx_photos_event_taken ON photos(event_id, taken_at, created_at);
CREATE UNIQUE INDEX idx_photos_event_hash
  ON photos(event_id, content_hash)
  WHERE content_hash IS NOT NULL;
