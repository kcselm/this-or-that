/**
 * Per-mode UI facts: names, labels, and which screen a room belongs on.
 * Game rules (item limits, player minimums) come from @tot/shared, which the
 * API enforces too.
 */
import { MODE_RULES, canStartWithItems, isMode, type Mode } from "@tot/shared";

export type { Mode };

export type RoomStatus = "open" | "voting" | "revealed" | "closed";

export const MODE_TITLES: Record<Mode, string> = {
  vote: "Swipe Vote",
  rank: "Blind Rank",
  bracket: "Bracket",
  mlt: "Most Likely To",
  tier: "Tier List",
};

/** Label on the host's start button. */
export const START_LABELS: Record<Mode, string> = {
  vote: "Start Voting",
  rank: "Start Ranking",
  bracket: "Start Tournament",
  mlt: "Start Game",
  tier: "Start Tier List",
};

/** What the waiting screen says a player who isn't done yet is doing. */
export const IN_PROGRESS_LABELS: Record<Mode, string> = {
  vote: "Swiping...",
  rank: "Ranking...",
  bracket: "Voting...",
  mlt: "Voting on prompts...",
  tier: "Sorting...",
};

const PLAY_SCREENS = {
  vote: "/room/[code]/swipe",
  rank: "/room/[code]/rank",
  bracket: "/room/[code]/bracket",
  mlt: "/room/[code]/mlt",
  tier: "/room/[code]/tier",
} as const satisfies Record<Mode, string>;

export type PlayScreen = (typeof PLAY_SCREENS)[Mode];

/** The screen where a player takes part in a started game. */
export function playScreen(mode: Mode): PlayScreen {
  return PLAY_SCREENS[mode];
}

export type RoomScreen = "/create/share" | "/room/[code]/lobby" | PlayScreen | "/room/[code]/results";

/**
 * Where someone belongs in a room right now: the host's setup screen or the
 * lobby while it's open, the game once it starts, then the results. A closed
 * room has nowhere to go, so that's null.
 */
export function roomScreen(status: RoomStatus, mode: Mode, isCreator: boolean): RoomScreen | null {
  switch (status) {
    case "open":
      return isCreator ? "/create/share" : "/room/[code]/lobby";
    case "voting":
      return playScreen(mode);
    case "revealed":
      return "/room/[code]/results";
    case "closed":
      return null;
  }
}

/** A mode from a route param, falling back to swipe vote. */
export function parseMode(value: string | undefined): Mode {
  return isMode(value) ? value : "vote";
}

/** Why the host can't start yet, or null when they can. */
export function startBlocker(mode: Mode, itemCount: number, playerCount: number): string | null {
  const { minItems, maxItems, itemNoun, minPlayersToStart } = MODE_RULES[mode];
  if (!canStartWithItems(mode, itemCount)) {
    return minItems === maxItems
      ? `Add exactly ${minItems} ${itemNoun} to start (${itemCount}/${maxItems}).`
      : `Add at least ${minItems} ${itemNoun} to start.`;
  }
  if (playerCount < minPlayersToStart) {
    return `${playerCount} of ${minPlayersToStart} joined — share the code to fill the room.`;
  }
  return null;
}
