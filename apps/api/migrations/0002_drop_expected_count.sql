-- Remove expected_count from rooms table
-- Must recreate all tables due to SQLite FK reference rewriting on rename

-- Step 1: Rename all tables
ALTER TABLE rooms RENAME TO rooms_old;
ALTER TABLE items RENAME TO items_old;
ALTER TABLE votes RENAME TO votes_old;

-- Step 2: Recreate tables with correct schema
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  topic TEXT NOT NULL,
  creator_voter_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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

-- Step 3: Copy data
INSERT INTO rooms (id, code, topic, creator_voter_id, status, created_at, expires_at)
  SELECT id, code, topic, creator_voter_id, status, created_at, expires_at FROM rooms_old;

INSERT INTO items (id, room_id, title, sort_order, created_at)
  SELECT id, room_id, title, sort_order, created_at FROM items_old;

INSERT INTO votes (id, room_id, item_id, voter_id, voter_name, vote, created_at)
  SELECT id, room_id, item_id, voter_id, voter_name, vote, created_at FROM votes_old;

-- Step 4: Drop old tables
DROP TABLE votes_old;
DROP TABLE items_old;
DROP TABLE rooms_old;

-- Step 5: Recreate indexes
CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_items_room ON items(room_id);
CREATE INDEX idx_votes_room ON votes(room_id);
CREATE INDEX idx_votes_item ON votes(item_id);
