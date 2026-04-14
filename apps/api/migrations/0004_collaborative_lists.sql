-- Add collaborative list support
ALTER TABLE rooms ADD COLUMN allow_suggestions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN added_by_voter_id TEXT;
ALTER TABLE items ADD COLUMN added_by_name TEXT;
