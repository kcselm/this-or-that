import BracketTree from "./BracketTree";
import BracketList from "./BracketList";
import type { BracketRound } from "../lib/api";

// Flip to false to fall back to the round-by-round list renderer.
const USE_TREE = true;

export type BracketViewProps = {
  rounds: BracketRound[];
  /** The just-completed round to emphasise (between-round reveal screen). */
  highlightRound?: number;
  /** Show per-matchup vote breakdowns when a matchup is tapped. */
  expandableBreakdowns?: boolean;
};

export default function BracketView(props: BracketViewProps) {
  if (USE_TREE) return <BracketTree {...props} />;
  return <BracketList rounds={props.rounds} expandableBreakdowns={props.expandableBreakdowns} />;
}
