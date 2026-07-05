CREATE TABLE guestbook (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id),
  guest_id    TEXT NOT NULL REFERENCES guests(id),
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_guestbook_event ON guestbook(event_id, created_at DESC);
