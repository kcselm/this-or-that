-- Host settings for draft rooms; NULL for every other mode.
ALTER TABLE rooms ADD COLUMN draft_order TEXT;      -- 'snake' | 'circle'
ALTER TABLE rooms ADD COLUMN draft_rounds INTEGER;  -- picks per player, 1..10

-- The drawn turn order, written once when the room starts.
CREATE TABLE draft_seats (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  voter_id TEXT NOT NULL,
  seat INTEGER NOT NULL,                 -- 0-based position in the order
  PRIMARY KEY (room_id, seat),
  UNIQUE (room_id, voter_id)
);

-- One row per pick. pick_index is the global 0-based pick number; the UNIQUE
-- constraints are what make "whose turn is it" and "no duplicates" race-safe.
CREATE TABLE draft_picks (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  pick_index INTEGER NOT NULL,
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,               -- pickKey(title)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (room_id, pick_index),
  UNIQUE (room_id, title_key)
);
CREATE INDEX idx_draft_picks_room_voter ON draft_picks(room_id, voter_id);
