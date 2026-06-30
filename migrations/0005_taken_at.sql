ALTER TABLE photos ADD COLUMN taken_at INTEGER;

CREATE INDEX idx_photos_event_taken ON photos(event_id, taken_at, created_at);
