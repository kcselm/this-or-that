-- The hourly cleanup cron finds expired rooms by expires_at.
CREATE INDEX idx_rooms_expires ON rooms(expires_at);

-- UNIQUE(code) already gives rooms.code an index; this one was a duplicate.
DROP INDEX IF EXISTS idx_rooms_code;
