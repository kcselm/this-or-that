/**
 * Pure helpers for saved lists — reusable item lists the host builds ahead of
 * time on their own device, then loads into a room. Storage lives in
 * storage.ts; this module only decides what goes in.
 */

export type SavedList = {
  id: string;
  name: string;
  items: string[];
  updatedAt: string;
};

// Lists aren't tied to a game mode, so they can hold more than any one room
// takes; importing trims to the room's own limit.
export const MAX_LIST_ITEMS = 50;
export const MAX_ITEM_LENGTH = 100;

/** Split typed or pasted text into entries — one per line, blanks dropped. */
export function splitEntries(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const key = (title: string) => title.trim().toLowerCase();

/**
 * Append entries to a list, skipping case-insensitive duplicates and anything
 * past the cap. Over-long entries are truncated rather than rejected so a
 * pasted list never silently loses a line.
 */
export function appendEntries(
  existing: string[],
  incoming: string[],
  max: number = MAX_LIST_ITEMS
): { items: string[]; duplicates: number; overflow: number } {
  const items = [...existing];
  const seen = new Set(existing.map(key));
  let duplicates = 0;
  let overflow = 0;
  for (const raw of incoming) {
    const title = raw.trim().slice(0, MAX_ITEM_LENGTH);
    if (!title) continue;
    if (seen.has(key(title))) {
      duplicates++;
      continue;
    }
    if (items.length >= max) {
      overflow++;
      continue;
    }
    items.push(title);
    seen.add(key(title));
  }
  return { items, duplicates, overflow };
}

/**
 * Work out which saved-list entries to add to a room that already has
 * `roomTitles`, given the room's item limit and per-item length limit.
 */
export function planImport(
  listItems: string[],
  roomTitles: string[],
  maxItems: number,
  maxLength: number = MAX_ITEM_LENGTH
): { toAdd: string[]; duplicates: number; overflow: number } {
  const seen = new Set(roomTitles.map(key));
  const toAdd: string[] = [];
  let duplicates = 0;
  let overflow = 0;
  for (const raw of listItems) {
    const title = raw.trim().slice(0, maxLength);
    if (!title) continue;
    if (seen.has(key(title))) {
      duplicates++;
      continue;
    }
    if (roomTitles.length + toAdd.length >= maxItems) {
      overflow++;
      continue;
    }
    toAdd.push(title);
    seen.add(key(title));
  }
  return { toAdd, duplicates, overflow };
}

/** One-line summary of what an import skipped, or null if nothing was. */
export function describeSkipped(duplicates: number, overflow: number, maxItems: number): string | null {
  const parts: string[] = [];
  if (duplicates > 0) {
    parts.push(`${duplicates} already in the room`);
  }
  if (overflow > 0) {
    parts.push(`${overflow} over the ${maxItems}-item limit`);
  }
  return parts.length ? `Skipped ${parts.join(" and ")}.` : null;
}
