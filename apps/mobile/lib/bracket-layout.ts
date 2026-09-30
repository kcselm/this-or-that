// Pure geometry for the bracket tree. Given the rounds the server has
// materialized and a container width, produces absolutely positioned name
// lines, connector segments and column headers in the style of a paper
// bracket: one name per line, pairs joined by a bracket into the next column.
//
// Two arrangements:
//   linear   — rounds run left to right, optionally ending in a WINNER column.
//   mirrored — the two halves of the draw meet at a CHAMPION column in the
//              middle, like a printed tournament sheet. Used when wide enough.
//
// Rounds that don't exist yet are drawn as empty placeholder slots using the
// rolling-bye shape rule, so the full bracket is visible from round 1.

import type { BracketRound } from "./api";
import { planRound } from "@tot/shared";

export type LineState = "winner" | "loser" | "pending" | "placeholder" | "champion";

export type BracketLine = {
  key: string;
  /** 1-based round; the champion line sits in round R + 1. */
  round: number;
  slot: number;
  matchupId: string | null;
  title: string | null;
  state: LineState;
  highlighted: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BracketColumn = {
  key: string;
  x: number;
  width: number;
  label: string;
  highlighted: boolean;
};

export type SegmentTone = "default" | "highlight" | "placeholder";

export type BracketSegment = {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tone: SegmentTone;
};

export type BracketMarker = { key: string; x: number; y: number; size: number };

export type BracketLayout = {
  mode: "linear" | "mirrored";
  width: number;
  height: number;
  headerHeight: number;
  fontSize: number;
  maxLines: number;
  lineHeight: number;
  columns: BracketColumn[];
  lines: BracketLine[];
  segments: BracketSegment[];
  markers: BracketMarker[];
};

export type LayoutInput = {
  rounds: BracketRound[];
  width: number;
  highlightRound?: number;
  mode?: "auto" | "linear" | "mirrored";
};

// --- constants ---------------------------------------------------------------

const HEADER_H = 26;
const PAIR_GAP = 6;
const SLOT_GAP = 14;
const STROKE = 2;
const MARKER = 8;
const BOTTOM_PAD = 4;
const WIDE_GAP = 20;
const NARROW_GAP = 14;
const MIN_COL_WITH_WINNER = 96;
const MIN_MIRRORED_COL = 110;

function metricsFor(colWidth: number): { fontSize: number; maxLines: number; lineHeight: number } {
  if (colWidth >= 150) return { fontSize: 14, maxLines: 1, lineHeight: 26 };
  if (colWidth >= 100) return { fontSize: 12, maxLines: 2, lineHeight: 34 };
  return { fontSize: 11, maxLines: 2, lineHeight: 32 };
}

// --- model -------------------------------------------------------------------

type Competitor = { id: string | null; title: string | null };

type Slot = {
  round: number; // 1-based
  slot: number;
  matchupId: string | null;
  competitors: Competitor[]; // 1 for a bye, otherwise 2
  winnerId: string | null;
  isBye: boolean;
  tiebreak: boolean;
  materialized: boolean;
};

type RoundModel = { round: number; slots: Slot[] };

const EMPTY: Competitor = { id: null, title: null };

function buildRounds(rounds: BracketRound[]): RoundModel[] {
  const models: RoundModel[] = [...rounds]
    .sort((a, b) => a.round - b.round)
    .map((r) => ({
      round: r.round,
      slots: [...r.matchups]
        .sort((a, b) => a.slot - b.slot)
        .map((m) => {
          const a: Competitor = { id: m.itemA?.id ?? null, title: m.itemA?.title ?? null };
          const b: Competitor | null = m.isBye || !m.itemB ? null : { id: m.itemB.id, title: m.itemB.title };
          return {
            round: r.round,
            slot: m.slot,
            matchupId: m.id,
            competitors: b ? [a, b] : [a],
            winnerId: m.winner?.id ?? null,
            isBye: b === null,
            tiebreak: m.decidedByTiebreak,
            materialized: true,
          };
        }),
    }));

  // Extend with empty rounds until a single slot (the final) exists.
  let last = models[models.length - 1];
  while (last && last.slots.length > 1) {
    const round = last.round + 1;
    const plan = planRound(last.slots.map((_, i) => i), round);
    const slots: Slot[] = plan.map((p) => ({
      round,
      slot: p.slot,
      matchupId: null,
      competitors: p.itemB === null ? [EMPTY] : [EMPTY, EMPTY],
      winnerId: null,
      isBye: p.itemB === null,
      tiebreak: false,
      materialized: false,
    }));
    last = { round, slots };
    models.push(last);
  }
  return models;
}

/** Global competitor index of (slot, competitor) within a round. */
function competitorOffsets(round: RoundModel): number[] {
  const offsets: number[] = [];
  let k = 0;
  for (const s of round.slots) {
    offsets.push(k);
    k += s.competitors.length;
  }
  return offsets;
}

/**
 * How many leading slots of each round (index i, up to the semifinal) feed
 * the final's left competitor. Competitor k of a round is the winner of
 * slot k in the round before, so each half is a contiguous prefix/suffix.
 */
function leftSlotCounts(models: RoundModel[]): number[] {
  const R = models.length;
  const left = new Array<number>(R).fill(0);
  if (R < 2) return left;
  left[R - 2] = 1;
  for (let i = R - 2; i > 0; i--) {
    let count = 0;
    for (let s = 0; s < left[i]; s++) count += models[i].slots[s].competitors.length;
    left[i - 1] = count;
  }
  return left;
}

// --- vertical placement ------------------------------------------------------

type RuleMap = Map<string, number>; // "roundIdx:slot:competitor" -> rule y (bottom of the name box)

const ruleKey = (roundIdx: number, slot: number, comp: number) => `${roundIdx}:${slot}:${comp}`;

function slotCenter(rules: RuleMap, roundIdx: number, s: Slot): number {
  let sum = 0;
  for (let c = 0; c < s.competitors.length; c++) sum += rules.get(ruleKey(roundIdx, s.slot, c))!;
  return sum / s.competitors.length;
}

/**
 * Assign rule y's for one side of the bracket. `range(i)` gives the slot
 * index range [start, end) of round i that belongs to this side; the first
 * round stacks from y = 0 and later rounds center on their source slots.
 * Returns the stack height.
 */
function assignRules(
  models: RoundModel[],
  lastRoundIdx: number,
  range: (roundIdx: number) => [number, number],
  lineHeight: number,
  rules: RuleMap
): number {
  let y = 0;
  const [start0, end0] = range(0);
  for (let s = start0; s < end0; s++) {
    const slot = models[0].slots[s];
    slot.competitors.forEach((_, c) => {
      y += lineHeight;
      rules.set(ruleKey(0, slot.slot, c), y);
      if (c < slot.competitors.length - 1) y += PAIR_GAP;
    });
    y += SLOT_GAP;
  }
  const height = Math.max(0, y - SLOT_GAP);

  for (let i = 1; i <= lastRoundIdx; i++) {
    const offsets = competitorOffsets(models[i]);
    const [start, end] = range(i);
    for (let s = start; s < end; s++) {
      const slot = models[i].slots[s];
      slot.competitors.forEach((_, c) => {
        const source = models[i - 1].slots[offsets[s] + c];
        rules.set(ruleKey(i, slot.slot, c), slotCenter(rules, i - 1, source));
      });
    }
  }
  return height;
}

// --- emission ----------------------------------------------------------------

type Emit = {
  lines: BracketLine[];
  segments: BracketSegment[];
  markers: BracketMarker[];
};

function stateFor(slot: Slot, comp: Competitor): LineState {
  if (comp.title === null) return "placeholder";
  if (!slot.winnerId) return "pending";
  return comp.id === slot.winnerId ? "winner" : "loser";
}

function toneFor(slot: Slot, highlightRound: number | undefined): SegmentTone {
  if (!slot.materialized) return "placeholder";
  return slot.round === highlightRound ? "highlight" : "default";
}

function emitSlot(
  out: Emit,
  slot: Slot,
  roundIdx: number,
  rules: RuleMap,
  yOffset: number,
  colX: number,
  colW: number,
  gap: number,
  dir: 1 | -1,
  /** "full" runs the connector into the next column; "join" stops at the bracket. */
  link: "full" | "join",
  lineHeight: number,
  highlightRound: number | undefined
) {
  const tone = toneFor(slot, highlightRound);
  const highlighted = slot.round === highlightRound;
  const ys = slot.competitors.map((_, c) => rules.get(ruleKey(roundIdx, slot.slot, c))! + yOffset);

  slot.competitors.forEach((comp, c) => {
    out.lines.push({
      key: `L${roundIdx}:${slot.slot}:${c}`,
      round: slot.round,
      slot: slot.slot,
      matchupId: slot.matchupId,
      title: comp.title,
      state: stateFor(slot, comp),
      highlighted,
      x: colX,
      y: ys[c] - lineHeight,
      width: colW,
      height: lineHeight,
    });
  });

  const edge = dir === 1 ? colX + colW : colX; // where the rule leaves the column
  const half = gap / 2;
  const reach = link === "full" ? gap : half;
  const seg = (key: string, x1: number, x2: number, y1: number, y2: number) => {
    out.segments.push({
      key: `${key}:${roundIdx}:${slot.slot}`,
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.max(Math.abs(x2 - x1), STROKE),
      height: Math.max(Math.abs(y2 - y1), STROKE),
      tone,
    });
  };

  if (slot.competitors.length === 1) {
    // Bye: the rule runs straight across the gap.
    seg("bye", edge, edge + dir * reach, ys[0], ys[0]);
    return;
  }

  const xJoin = edge + dir * half;
  const outY = (ys[0] + ys[1]) / 2;
  seg("stubA", edge, xJoin, ys[0], ys[0]);
  seg("stubB", edge, xJoin, ys[1], ys[1]);
  seg("join", xJoin, xJoin, ys[0], ys[1] + STROKE);
  if (link === "full") seg("out", xJoin, edge + dir * gap, outY, outY);

  if (slot.tiebreak) {
    out.markers.push({
      key: `M${roundIdx}:${slot.slot}`,
      x: xJoin + STROKE / 2 - MARKER / 2,
      y: outY + STROKE / 2 - MARKER / 2,
      size: MARKER,
    });
  }
}

// --- public entry point ------------------------------------------------------

export function layoutBracket(input: LayoutInput): BracketLayout {
  const { width, highlightRound } = input;
  const models = buildRounds(input.rounds);
  const R = models.length;
  const empty: BracketLayout = {
    mode: "linear",
    width,
    height: 0,
    headerHeight: HEADER_H,
    fontSize: 12,
    maxLines: 1,
    lineHeight: 26,
    columns: [],
    lines: [],
    segments: [],
    markers: [],
  };
  if (R === 0) return empty;

  const requested = input.mode ?? "auto";
  const mirroredColW = (width - WIDE_GAP * 2 * R) / (2 * R + 1);
  const mirrored =
    R >= 2 &&
    (requested === "mirrored" || (requested === "auto" && mirroredColW >= MIN_MIRRORED_COL));

  return mirrored
    ? layoutMirrored(models, width, highlightRound)
    : layoutLinear(models, width, highlightRound);
}

function roundLabel(roundIdx: number, R: number): string {
  return roundIdx === R - 1 ? "FINAL" : `ROUND ${roundIdx + 1}`;
}

function layoutLinear(models: RoundModel[], width: number, highlightRound?: number): BracketLayout {
  const R = models.length;

  // Column count: rounds plus a WINNER column when there is room for it.
  let gap = WIDE_GAP;
  let withWinner = (width - gap * R) / (R + 1) >= MIN_COL_WITH_WINNER;
  let columns = withWinner ? R + 1 : R;
  // Without a winner column, keep a tail so the final's bracket (and a
  // possible coin-flip marker) can be drawn inside the width.
  const tailFor = (g: number) => (withWinner ? 0 : g / 2 + MARKER / 2 + STROKE);
  let colW = (width - gap * (columns - 1) - tailFor(gap)) / columns;
  if (colW < 100) {
    gap = NARROW_GAP;
    colW = (width - gap * (columns - 1) - tailFor(gap)) / columns;
  }
  const metrics = metricsFor(colW);
  const colX = (i: number) => i * (colW + gap);

  const rules: RuleMap = new Map();
  const stackHeight = assignRules(models, R - 1, (i) => [0, models[i].slots.length], metrics.lineHeight, rules);
  const yOffset = HEADER_H;

  const out: Emit = { lines: [], segments: [], markers: [] };
  const cols: BracketColumn[] = [];

  for (let i = 0; i < R; i++) {
    cols.push({
      key: `C${i}`,
      x: colX(i),
      width: colW,
      label: roundLabel(i, R),
      highlighted: models[i].round === highlightRound,
    });
    const link = i === R - 1 && !withWinner ? "join" : "full";
    for (const slot of models[i].slots) {
      emitSlot(out, slot, i, rules, yOffset, colX(i), colW, gap, 1, link, metrics.lineHeight, highlightRound);
    }
  }

  const final = models[R - 1].slots[0];
  if (!withWinner && final.winnerId) {
    // No winner column to carry the champion, so crown them in the final.
    for (const line of out.lines) {
      if (line.matchupId === final.matchupId && line.state === "winner") line.state = "champion";
    }
  }
  if (withWinner) {
    cols.push({ key: "W", x: colX(R), width: colW, label: "WINNER", highlighted: false });
    const winner = championOf(final);
    const y = slotCenter(rules, R - 1, final) + yOffset;
    out.lines.push({
      key: "champion",
      round: R + 1,
      slot: 0,
      matchupId: final.matchupId,
      title: winner.title,
      state: winner.title ? "champion" : "placeholder",
      highlighted: false,
      x: colX(R),
      y: y - metrics.lineHeight,
      width: colW,
      height: metrics.lineHeight,
    });
  }

  return {
    mode: "linear",
    width,
    height: HEADER_H + stackHeight + BOTTOM_PAD,
    headerHeight: HEADER_H,
    fontSize: metrics.fontSize,
    maxLines: metrics.maxLines,
    lineHeight: metrics.lineHeight,
    columns: cols,
    lines: out.lines,
    segments: out.segments,
    markers: out.markers,
  };
}

function championOf(final: Slot): Competitor {
  if (!final.winnerId) return EMPTY;
  return final.competitors.find((c) => c.id === final.winnerId) ?? EMPTY;
}

function layoutMirrored(models: RoundModel[], width: number, highlightRound?: number): BracketLayout {
  const R = models.length;
  const gap = WIDE_GAP;
  const columns = 2 * R + 1;
  const colW = (width - gap * (columns - 1)) / columns;
  const metrics = metricsFor(colW);
  const colX = (i: number) => i * (colW + gap);
  const leftX = (roundIdx: number) => colX(roundIdx);
  const rightX = (roundIdx: number) => colX(2 * R - roundIdx);
  const centerX = colX(R);

  const left = leftSlotCounts(models);
  const semi = R - 2; // last round index laid out per side
  const final = models[R - 1].slots[0];

  const leftRules: RuleMap = new Map();
  const rightRules: RuleMap = new Map();
  const leftH = assignRules(models, semi, (i) => [0, left[i]], metrics.lineHeight, leftRules);
  const rightH = assignRules(models, semi, (i) => [left[i], models[i].slots.length], metrics.lineHeight, rightRules);
  const stackHeight = Math.max(leftH, rightH);
  const leftOffset = HEADER_H + (stackHeight - leftH) / 2;
  const rightOffset = HEADER_H + (stackHeight - rightH) / 2;

  const out: Emit = { lines: [], segments: [], markers: [] };
  const cols: BracketColumn[] = [];

  for (let i = 0; i <= semi; i++) {
    const highlighted = models[i].round === highlightRound;
    cols.push({ key: `L${i}`, x: leftX(i), width: colW, label: roundLabel(i, R), highlighted });
    for (let s = 0; s < left[i]; s++) {
      emitSlot(out, models[i].slots[s], i, leftRules, leftOffset, leftX(i), colW, gap, 1, "full", metrics.lineHeight, highlightRound);
    }
  }

  // Finalists: one line on each side of the champion, then the champion.
  const finalHighlighted = final.round === highlightRound;
  const finalTone = toneFor(final, highlightRound);
  const finalistY = [
    slotCenter(leftRules, semi, models[semi].slots[0]) + leftOffset,
    slotCenter(rightRules, semi, models[semi].slots[1]) + rightOffset,
  ];
  const finalistX = [leftX(R - 1), rightX(R - 1)];
  cols.push({ key: `L${R - 1}`, x: finalistX[0], width: colW, label: "FINAL", highlighted: finalHighlighted });
  cols.push({ key: "C", x: centerX, width: colW, label: "CHAMPION", highlighted: false });
  cols.push({ key: `R${R - 1}`, x: finalistX[1], width: colW, label: "FINAL", highlighted: finalHighlighted });

  const championY = (finalistY[0] + finalistY[1]) / 2;
  final.competitors.forEach((comp, c) => {
    out.lines.push({
      key: `F${c}`,
      round: final.round,
      slot: 0,
      matchupId: final.matchupId,
      title: comp.title,
      state: stateFor(final, comp),
      highlighted: finalHighlighted,
      x: finalistX[c],
      y: finalistY[c] - metrics.lineHeight,
      width: colW,
      height: metrics.lineHeight,
    });
    const dir: 1 | -1 = c === 0 ? 1 : -1;
    const edge = c === 0 ? finalistX[0] + colW : finalistX[1];
    const centerEdge = c === 0 ? centerX : centerX + colW;
    const push = (key: string, x1: number, x2: number, y1: number, y2: number) =>
      out.segments.push({
        key,
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.max(Math.abs(x2 - x1), STROKE),
        height: Math.max(Math.abs(y2 - y1), STROKE),
        tone: finalTone,
      });
    push(`finalStub${c}`, edge, edge + dir * gap, finalistY[c], finalistY[c]);
    if (Math.abs(finalistY[c] - championY) > 0.5) {
      push(`finalRise${c}`, centerEdge, centerEdge, finalistY[c], championY + STROKE);
    }
  });
  if (final.tiebreak) {
    out.markers.push({
      key: "Mfinal",
      x: centerX + colW / 2 - MARKER / 2,
      y: championY - metrics.lineHeight - MARKER / 2,
      size: MARKER,
    });
  }

  const winner = championOf(final);
  out.lines.push({
    key: "champion",
    round: R + 1,
    slot: 0,
    matchupId: final.matchupId,
    title: winner.title,
    state: winner.title ? "champion" : "placeholder",
    highlighted: false,
    x: centerX,
    y: championY - metrics.lineHeight,
    width: colW,
    height: metrics.lineHeight,
  });

  for (let i = semi; i >= 0; i--) {
    const highlighted = models[i].round === highlightRound;
    cols.push({ key: `R${i}`, x: rightX(i), width: colW, label: roundLabel(i, R), highlighted });
    for (let s = left[i]; s < models[i].slots.length; s++) {
      emitSlot(out, models[i].slots[s], i, rightRules, rightOffset, rightX(i), colW, gap, -1, "full", metrics.lineHeight, highlightRound);
    }
  }

  return {
    mode: "mirrored",
    width,
    height: HEADER_H + stackHeight + BOTTOM_PAD,
    headerHeight: HEADER_H,
    fontSize: metrics.fontSize,
    maxLines: metrics.maxLines,
    lineHeight: metrics.lineHeight,
    columns: cols,
    lines: out.lines,
    segments: out.segments,
    markers: out.markers,
  };
}
