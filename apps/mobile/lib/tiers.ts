import type { Tier } from "@tot/shared";

export { TIERS } from "@tot/shared";

// A chip lives in a tier or in the unplaced pool.
export type TierZone = Tier | "pool";

export const TIER_META: Record<
  Tier,
  { label: string; badge: string; text: string; rowBg: string }
> = {
  S: { label: "S", badge: "#E5484D", text: "#FFFFFF", rowBg: "#FDEEEE" },
  A: { label: "A", badge: "#F76B15", text: "#FFFFFF", rowBg: "#FDF0E6" },
  B: { label: "B", badge: "#F5A623", text: "#FFFFFF", rowBg: "#FDF6E7" },
  C: { label: "C", badge: "#3FA45B", text: "#FFFFFF", rowBg: "#EBF6EE" },
  D: { label: "D", badge: "#3E7BB6", text: "#FFFFFF", rowBg: "#EAF1F8" },
};
