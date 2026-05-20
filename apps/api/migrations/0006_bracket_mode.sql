-- The `mode` column already exists (added in 0005). Allowed values become
-- 'vote' | 'rank' | 'bracket' — no schema constraint, the app enforces it.

CREATE TABLE matchups (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  round INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  item_a_id TEXT REFERENCES items(id),
  item_b_id TEXT REFERENCES items(id),
  winner_item_id TEXT REFERENCES items(id),
  is_bye INTEGER NOT NULL DEFAULT 0,
  decided_by_tiebreak INTEGER NOT NULL DEFAULT 0,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_id, round, slot)
);

CREATE TABLE matchup_votes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  matchup_id TEXT NOT NULL REFERENCES matchups(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  picked_item_id TEXT NOT NULL REFERENCES items(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(matchup_id, voter_id)
);

CREATE INDEX idx_matchups_room ON matchups(room_id);
CREATE INDEX idx_matchups_room_round ON matchups(room_id, round);
CREATE INDEX idx_matchup_votes_room ON matchup_votes(room_id);
CREATE INDEX idx_matchup_votes_matchup ON matchup_votes(matchup_id);
CREATE INDEX idx_matchup_votes_room_voter ON matchup_votes(room_id, voter_id);
