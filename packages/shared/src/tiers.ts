// Tier list mode: tiers from best to worst, and the numeric value each tier
// contributes when averaging everyone's boards into the consensus board.

export const TIERS = ["S", "A", "B", "C", "D"] as const;

export type Tier = (typeof TIERS)[number];

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

export const TIER_VALUE: Record<Tier, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 };

/** The tier an averaged tier value rounds to. */
export function tierForAverage(average: number): Tier {
  const value = Math.min(5, Math.max(1, Math.round(average)));
  return TIERS[5 - value];
}
