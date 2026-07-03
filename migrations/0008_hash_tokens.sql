-- Store bearer tokens as one-way SHA-256 hashes instead of plaintext, so a DB
-- dump alone cannot be replayed against the live app. (The OAuth access/refresh
-- tokens that unlock cloud storage were already AES-256-GCM encrypted.)

-- Defer FK enforcement so the events recreate (children reference events(id))
-- doesn't trip FOREIGN KEY constraints mid-migration. D1/SQLite re-checks at
-- transaction end, by which point events is repopulated with the same ids.
PRAGMA defer_foreign_keys = ON;

-- Guests: session_token is always set at registration, so a straight rename
-- keeps the NOT NULL + UNIQUE guarantees. New sessions store the hash.
ALTER TABLE guests RENAME COLUMN session_token TO session_token_hash;

-- Events: the admin token is now generated at the OAuth callback (the only
-- post-connect place that can email it), so the hash column must be NULLABLE —
-- an event exists between /create and connect with no token yet. SQLite cannot
-- drop a NOT NULL constraint via ALTER, so recreate the table. There is no FK
-- cascade in this schema (deletes are done children-first in code), so dropping
-- and recreating events is safe. Existing rows' plaintext admin_token cannot be
-- re-hashed in pure SQL (no SHA-256 in SQLite); they migrate to a NULL hash and
-- their hosts must re-open the original admin link — acceptable pre-launch, and
-- those plaintext tokens were exactly the exposure being removed.
CREATE TABLE events_new (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  host_email      TEXT,
  admin_token_hash TEXT,
  provider        TEXT NOT NULL DEFAULT 'google_drive',
  access_token    TEXT,
  refresh_token   TEXT,
  token_expiry    INTEGER,
  folder_id       TEXT,
  folder_url      TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at      INTEGER,
  cover_photo_id  TEXT,
  folder_name     TEXT,
  videos_enabled  INTEGER NOT NULL DEFAULT 0,
  video_max_bytes INTEGER
);

INSERT INTO events_new
  (id, title, host_email, admin_token_hash, provider, access_token,
   refresh_token, token_expiry, folder_id, folder_url, created_at, expires_at,
   cover_photo_id, folder_name, videos_enabled, video_max_bytes)
SELECT
   id, title, host_email, NULL, provider, access_token,
   refresh_token, token_expiry, folder_id, folder_url, created_at, expires_at,
   cover_photo_id, folder_name, videos_enabled, video_max_bytes
FROM events;

DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
