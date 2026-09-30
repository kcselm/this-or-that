// Rolling-bye bracket shape.
//
// Every round plays floor(n/2) matchups and sits out at most one competitor.
// The bye takes the LAST slot in odd-numbered rounds and the FIRST slot in
// even-numbered rounds, so no item sits out twice in a row and the whole
// bracket shape follows from the item count alone.
//
// Keep in sync with apps/mobile/lib/bracket-shape.ts, which the client uses to
// draw the empty slots of rounds that haven't been created yet.

export type PlannedSlot = {
  slot: number;
  itemA: string;
  /** null marks a bye: itemA advances without a matchup. */
  itemB: string | null;
};

export function byeAtFirst(round: number): boolean {
  return round % 2 === 0;
}

/**
 * Lay out the matchups for `round` given its competitors in bracket order.
 * A lone competitor is the champion, so the plan is empty.
 */
export function planRound(competitors: string[], round: number): PlannedSlot[] {
  const n = competitors.length;
  if (n < 2) return [];

  const pairs = Math.floor(n / 2);
  const hasBye = n % 2 === 1;
  const slots: PlannedSlot[] = [];

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
