-- Rooms table
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  topic TEXT NOT NULL,
  creator_voter_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  allow_suggestions INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'vote',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Items in a room
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  added_by_voter_id TEXT,
  added_by_name TEXT,
  presentation_order INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Votes (one per voter per item)
CREATE TABLE votes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  vote TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, voter_id)
);

-- Rankings (one per voter per item in rank mode; rank 1-5)
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

-- Participants (who has joined the room)
CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_id, voter_id)
);

-- Matchups (bracket mode)
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

-- Matchup votes (bracket mode)
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

-- Most Likely To votes (mlt mode)
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

-- Indexes
CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_items_room ON items(room_id);
CREATE INDEX idx_votes_room ON votes(room_id);
CREATE INDEX idx_votes_item ON votes(item_id);
CREATE INDEX idx_participants_room ON participants(room_id);
CREATE INDEX idx_rankings_room ON rankings(room_id);
CREATE INDEX idx_rankings_room_voter ON rankings(room_id, voter_id);
CREATE INDEX idx_matchups_room ON matchups(room_id);
CREATE INDEX idx_matchups_room_round ON matchups(room_id, round);
CREATE INDEX idx_matchup_votes_room ON matchup_votes(room_id);
CREATE INDEX idx_matchup_votes_matchup ON matchup_votes(matchup_id);
CREATE INDEX idx_matchup_votes_room_voter ON matchup_votes(room_id, voter_id);
CREATE INDEX idx_mlt_votes_room ON mlt_votes(room_id);
CREATE INDEX idx_mlt_votes_item ON mlt_votes(item_id);
CREATE INDEX idx_mlt_votes_room_voter ON mlt_votes(room_id, voter_id);
