// Draft mode: players take turns claiming free-text picks for the topic. The
// turn order is a fixed seating drawn when the room starts; these helpers say
// whose turn a given pick is, so the API can enforce it and the app can show it.

export const DRAFT_ORDERS = ["snake", "circle"] as const;

export type DraftOrder = (typeof DRAFT_ORDERS)[number];

export function isDraftOrder(value: unknown): value is DraftOrder {
  return typeof value === "string" && (DRAFT_ORDERS as readonly string[]).includes(value);
}

/** Picks per player: the host chooses within this range. */
export const DRAFT_ROUNDS = { min: 1, max: 10, default: 5 } as const;

/** Whether `value` is a valid picks-per-player count. */
export function isDraftRounds(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= DRAFT_ROUNDS.min &&
    value <= DRAFT_ROUNDS.max
  );
}

/** How many picks a full draft has. */
export function totalPicks(seats: number, rounds: number): number {
  return seats * rounds;
}

/** The round (0-based) that pick `pickIndex` (0-based) belongs to. */
export function roundForPick(seats: number, pickIndex: number): number {
  return Math.floor(pickIndex / seats);
}

/**
 * Which seat (0-based position in the drawn order) makes pick `pickIndex`.
 * A snake draft reverses direction every round (1-2-3-3-2-1); a circle draft
 * keeps the same direction (1-2-3-1-2-3).
 */
export function seatForPick(order: DraftOrder, seats: number, pickIndex: number): number {
  const position = pickIndex % seats;
  const reversed = order === "snake" && roundForPick(seats, pickIndex) % 2 === 1;
  return reversed ? seats - 1 - position : position;
}

/**
 * The key two picks are compared on for the no-duplicates rule: trimmed,
 * inner whitespace collapsed, lower-cased in JS (SQLite's lower() is ASCII-only).
 */
export function pickKey(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}
