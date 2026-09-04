// How much room a matchup card actually gets, derived from the window rather
// than measured. onLayout is unreliable on web (it does not fire at all in the
// Expo web build), and the matchup screen draws fixed chrome around the pair,
// so the geometry is cheaper and steadier to compute than to observe.

import { spacing } from "./theme";

/** Below this width the pair stacks; each card then spans the full column. */
export const STACK_BREAKPOINT = 600;

// The chrome the screen draws around the cards, in the order it appears.
const TOP_PAD = 12; // container paddingTop, on top of the safe-area inset
const HEADER_H = 68; // topic + round/matchup line + marginBottom
const HINT_H = 32; // "Tap a card to pick a winner"; reserved even once it goes
const BOTTOM_PAD = spacing.xl; // container paddingBottom
const GAPS = spacing.md * 2; // card | gap | vs | gap | card
const VS_ACROSS = 34; // the "vs" label's width when the pair sits side by side
const VS_DOWN = 32; // ...and its height when the pair is stacked

const MIN_SIDE = 80;

export type MatchupLayout = {
  stacked: boolean;
  /** Outer size of one card, padding included. */
  card: { width: number; height: number };
};

export function matchupLayout(
  windowWidth: number,
  windowHeight: number,
  insetTop: number
): MatchupLayout {
  const stacked = windowWidth < STACK_BREAKPOINT;
  const contentWidth = windowWidth - spacing.xl * 2;
  const contentHeight = windowHeight - insetTop - TOP_PAD - HEADER_H - HINT_H - BOTTOM_PAD;

  const card = stacked
    ? { width: contentWidth, height: (contentHeight - GAPS - VS_DOWN) / 2 }
    : { width: (contentWidth - GAPS - VS_ACROSS) / 2, height: contentHeight };

  return {
    stacked,
    card: {
      width: Math.max(MIN_SIDE, Math.floor(card.width)),
      height: Math.max(MIN_SIDE, Math.floor(card.height)),
    },
  };
}
