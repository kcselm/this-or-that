-- Room series: chains successor rooms for "keep playing" multi-round play.
-- series_id = id of the first room in the chain (NULL until/unless the room
-- is part of a series). next_host_voter_id is a credential — never expose it.
ALTER TABLE rooms ADD COLUMN series_id TEXT;
ALTER TABLE rooms ADD COLUMN round_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rooms ADD COLUMN next_host_voter_id TEXT;
ALTER TABLE rooms ADD COLUMN next_room_id TEXT;

CREATE INDEX idx_rooms_series ON rooms(series_id);
