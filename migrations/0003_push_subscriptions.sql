CREATE TABLE push_subscriptions (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id),
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(event_id, endpoint)
);

CREATE INDEX idx_push_event ON push_subscriptions(event_id);
