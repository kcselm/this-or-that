// Rolling-bye bracket shape.
//
// Every round plays floor(n/2) matchups and sits out at most one competitor.
// The bye takes the LAST slot in odd-numbered rounds and the FIRST slot in
// even-numbered rounds, so no item sits out twice in a row and the whole
// bracket shape follows from the item count alone. The server uses this to
// create each round; the client uses it to draw the empty slots of rounds the
// server hasn't created yet.

export type PlannedSlot<T> = {
  slot: number;
  itemA: T;
  /** null marks a bye: itemA advances without a matchup. */
  itemB: T | null;
};

export function byeAtFirst(round: number): boolean {
  return round % 2 === 0;
}

/**
 * Lay out the matchups for `round` given its competitors in bracket order.
 * A lone competitor is the champion, so the plan is empty.
 */
export function planRound<T>(competitors: T[], round: number): PlannedSlot<T>[] {
  const n = competitors.length;
  if (n < 2) return [];

  const pairs = Math.floor(n / 2);
  const hasBye = n % 2 === 1;
  const slots: PlannedSlot<T>[] = [];

  if (hasBye && byeAtFirst(round)) {
    slots.push({ slot: 0, itemA: competitors[0], itemB: null });
    for (let p = 0; p < pairs; p++) {
      slots.push({ slot: p + 1, itemA: competitors[1 + p * 2], itemB: competitors[2 + p * 2] });
    }
    return slots;
  }

  for (let p = 0; p < pairs; p++) {
    slots.push({ slot: p, itemA: competitors[p * 2], itemB: competitors[p * 2 + 1] });
  }
  if (hasBye) {
    slots.push({ slot: pairs, itemA: competitors[n - 1], itemB: null });
  }
  return slots;
}

/**
 * Rounds needed to crown a champion from `itemCount` items: every round
 * halves the field (rounding up for the bye), so it's ceil(log2(n)).
 */
export function totalRoundsFor(itemCount: number): number {
  let rounds = 0;
  for (let n = itemCount; n > 1; n = Math.ceil(n / 2)) rounds++;
  return rounds;
}
