// Game modes and the rules that differ between them. The API enforces these
// and the app mirrors them in its UI, so both import them from here.

export const MODES = ["vote", "rank", "bracket", "mlt", "tier"] as const;

export type Mode = (typeof MODES)[number];

export function isMode(value: unknown): value is Mode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

export type ModeRules = {
  /** How the mode is named mid-sentence, e.g. "a blind rank room". */
  label: string;
  /** What the mode calls its items ("items" or "prompts"). */
  itemNoun: string;
  /** Items the room must have before the host can start. */
  minItems: number;
  maxItems: number;
  /** Longest allowed item title, in characters. */
  maxItemLength: number;
  /** Whether the host may let participants suggest items. */
  suggestions: boolean;
  /** Participants (including the host) needed before the host can start. */
  minPlayersToStart: number;
  /** Participants needed before results can reveal automatically. */
  minPlayersToReveal: number;
};

export const MODE_RULES: Record<Mode, ModeRules> = {
  vote: {
    label: "swipe vote",
    itemNoun: "items",
    minItems: 2,
    maxItems: 15,
    maxItemLength: 100,
    suggestions: true,
    minPlayersToStart: 1,
    minPlayersToReveal: 2,
  },
  rank: {
    label: "blind rank",
    itemNoun: "items",
    minItems: 5,
    maxItems: 5,
    maxItemLength: 100,
    suggestions: false,
    minPlayersToStart: 1,
    minPlayersToReveal: 2,
  },
  bracket: {
    label: "bracket",
    itemNoun: "items",
    minItems: 4,
    maxItems: 16,
    maxItemLength: 100,
    suggestions: false,
    minPlayersToStart: 1,
    minPlayersToReveal: 2,
  },
  mlt: {
    label: "Most Likely To",
    itemNoun: "prompts",
    minItems: 3,
    maxItems: 15,
    maxItemLength: 80,
    suggestions: true,
    minPlayersToStart: 3,
    minPlayersToReveal: 3,
  },
  tier: {
    label: "tier list",
    itemNoun: "items",
    minItems: 3,
    maxItems: 12,
    maxItemLength: 100,
    suggestions: false,
    minPlayersToStart: 1,
    minPlayersToReveal: 2,
  },
};

/** Rank slots in a blind rank room: every item gets a unique rank 1..N. */
export const RANK_SLOTS = MODE_RULES.rank.maxItems;

/** Whether `itemCount` items is a valid room size to start `mode`. */
export function canStartWithItems(mode: Mode, itemCount: number): boolean {
  const { minItems, maxItems } = MODE_RULES[mode];
  return itemCount >= minItems && itemCount <= maxItems;
}

/** The message shown when the item count doesn't allow starting. */
export function startItemsMessage(mode: Mode): string {
  const { label, itemNoun, minItems, maxItems } = MODE_RULES[mode];
  const room = `${label[0].toUpperCase()}${label.slice(1)} rooms`;
  return minItems === maxItems
    ? `${room} need exactly ${minItems} ${itemNoun} to start`
    : `${room} need between ${minItems} and ${maxItems} ${itemNoun} to start`;
}
