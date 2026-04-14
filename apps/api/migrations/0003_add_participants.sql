-- Track who has joined a room before voting starts
CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_id, voter_id)
);

CREATE INDEX idx_participants_room ON participants(room_id);
