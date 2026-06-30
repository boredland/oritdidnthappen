-- Admin-gated video uploads. A video is just a photos row whose mime_type
-- starts with `video/`; the host explicitly enables video per event and sets a
-- size cap. The poster is a client-generated JPEG uploaded alongside the video.
ALTER TABLE events ADD COLUMN videos_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN video_max_bytes INTEGER;          -- NULL until the admin sets one
ALTER TABLE photos ADD COLUMN poster_ref TEXT;                  -- cloud file_ref of the client-made poster; NULL for images and posterless videos
