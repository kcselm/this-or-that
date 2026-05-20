ALTER TABLE rooms ADD COLUMN mode TEXT NOT NULL DEFAULT 'vote';
ALTER TABLE items ADD COLUMN presentation_order INTEGER;

CREATE TABLE rankings (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_id, voter_id, item_id),
  UNIQUE(room_id, voter_id, rank)
);

CREATE INDEX idx_rankings_room ON rankings(room_id);
CREATE INDEX idx_rankings_room_voter ON rankings(room_id, voter_id);
