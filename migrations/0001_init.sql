CREATE TABLE events (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  host_email      TEXT,
  admin_token     TEXT NOT NULL UNIQUE,
  provider        TEXT NOT NULL DEFAULT 'google_drive',
  access_token    TEXT,
  refresh_token   TEXT,
  token_expiry    INTEGER,
  folder_id       TEXT,
  folder_url      TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at      INTEGER
);

CREATE TABLE guests (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events(id),
  username       TEXT NOT NULL,
  session_token  TEXT NOT NULL UNIQUE,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(event_id, username)
);

CREATE TABLE photos (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events(id),
  guest_id       TEXT NOT NULL REFERENCES guests(id),
  file_ref       TEXT NOT NULL,
  filename       TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_photos_event ON photos(event_id, created_at DESC);
CREATE INDEX idx_guests_event ON guests(event_id);
