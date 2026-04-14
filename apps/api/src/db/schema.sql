-- Rooms table
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  topic TEXT NOT NULL,
  creator_voter_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  allow_suggestions INTEGER NOT NULL DEFAULT 0,
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

-- Participants (who has joined the room)
CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_id, voter_id)
);

-- Indexes
CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_items_room ON items(room_id);
CREATE INDEX idx_votes_room ON votes(room_id);
CREATE INDEX idx_votes_item ON votes(item_id);
CREATE INDEX idx_participants_room ON participants(room_id);
