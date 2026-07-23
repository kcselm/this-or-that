CREATE TABLE tier_placements (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK(tier IN ('S','A','B','C','D')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, voter_id)
);

CREATE INDEX idx_tier_placements_room ON tier_placements(room_id);
CREATE INDEX idx_tier_placements_room_voter ON tier_placements(room_id, voter_id);
