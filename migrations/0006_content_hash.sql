-- Per-event content deduplication: a SHA-256 of each uploaded file's bytes.
-- The unique index makes concurrent duplicate uploads impossible at the DB
-- layer, not just "checked then inserted."
ALTER TABLE photos ADD COLUMN content_hash TEXT;

CREATE UNIQUE INDEX idx_photos_event_hash
  ON photos(event_id, content_hash)
  WHERE content_hash IS NOT NULL;