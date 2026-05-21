-- The `mode` column already exists (added in 0005). Allowed values become
-- 'vote' | 'rank' | 'bracket' | 'mlt' — no schema constraint, the app enforces it.

CREATE TABLE mlt_votes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  target_voter_id TEXT NOT NULL,
  target_voter_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, voter_id)
);

CREATE INDEX idx_mlt_votes_room ON mlt_votes(room_id);
CREATE INDEX idx_mlt_votes_item ON mlt_votes(item_id);
CREATE INDEX idx_mlt_votes_room_voter ON mlt_votes(room_id, voter_id);
