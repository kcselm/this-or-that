import { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import type { BracketRound, BracketMatchup } from "../lib/api";
import { layoutBracket, type BracketLine, type SegmentTone } from "../lib/bracket-layout";
import { splitTitle } from "../lib/matchup-text";
import { colors, spacing, radius, typography, shadows } from "../lib/theme";

// A paper tournament sheet: one name per line, pairs joined by a bracket
// into the next column. The geometry lives in lib/bracket-layout.ts; this
// file only paints it. Fits any width without horizontal scrolling and
// switches to a mirrored draw (two halves meeting at the champion) when the
// container is wide enough.

type Props = {
  rounds: BracketRound[];
  /** The just-completed round to emphasise (between-round reveal screen). */
  highlightRound?: number;
  /** Show per-matchup vote breakdowns when a matchup is tapped. */
  expandableBreakdowns?: boolean;
};

const RULE = 2; // thickness of the ink rule under each name (matches the engine's stroke)

type MatchupEntry = { matchup: BracketMatchup; round: number; isFinal: boolean };

export default function BracketTree({ rounds, highlightRound, expandableBreakdowns }: Props) {
  const window = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Until onLayout reports, assume the screen minus the standard page padding.
  const width = measuredWidth ?? Math.max(240, window.width - spacing.xl * 2);
  const layout = useMemo(
    () => layoutBracket({ rounds, width, highlightRound }),
    [rounds, width, highlightRound]
  );

  const matchupsById = useMemo(() => {
    const map = new Map<string, MatchupEntry>();
    const lastRound = rounds.reduce((max, r) => Math.max(max, r.round), 0);
    for (const r of rounds) {
      for (const m of r.matchups) {
        map.set(m.id, {
          matchup: m,
          round: r.round,
          isFinal: r.round === lastRound && r.matchups.length === 1,
        });
      }
    }
    return map;
  }, [rounds]);

  const selected = selectedId ? (matchupsById.get(selectedId) ?? null) : null;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== measuredWidth) setMeasuredWidth(w);
  };

  if (rounds.length === 0) return null;

  return (
    <View onLayout={onLayout}>
      <View style={{ width: layout.width, height: layout.height }}>
        {layout.columns.map((col) => (
          <Text
            key={col.key}
            numberOfLines={1}
            style={[
              styles.columnLabel,
              { left: col.x, width: col.width },
              col.highlighted && styles.columnLabelHighlighted,
              (col.label === "WINNER" || col.label === "CHAMPION") && styles.columnLabelChampion,
            ]}
          >
            {col.label}
          </Text>
        ))}

        {layout.segments.map((seg) => (
          <View
            key={seg.key}
            style={[
              styles.segment,
              {
                left: seg.x,
                top: seg.y,
                width: seg.width,
                height: seg.height,
                backgroundColor: toneColor(seg.tone),
              },
            ]}
          />
        ))}

        {layout.lines.map((line, index) => (
          <NameLine
            key={line.key}
            line={line}
            index={index}
            fontSize={layout.fontSize}
            maxLines={layout.maxLines}
            selected={!!line.matchupId && line.matchupId === selectedId}
            onPress={
              line.matchupId && line.state !== "placeholder"
                ? () =>
                    setSelectedId((current) => (current === line.matchupId ? null : line.matchupId))
                : undefined
            }
          />
        ))}

        {layout.markers.map((mk) => (
          <View
            key={mk.key}
            style={[
              styles.marker,
              { left: mk.x, top: mk.y, width: mk.size, height: mk.size, borderRadius: mk.size / 2 },
            ]}
          />
        ))}
      </View>

      {selected && (
        <MatchupDetail
          entry={selected}
          showBreakdown={!!expandableBreakdowns}
          onClose={() => setSelectedId(null)}
        />
      )}
      {!selected && layout.lines.some((l) => l.matchupId && l.state !== "placeholder") && (
        <Text style={styles.hint}>
          {layout.mode === "mirrored" ? "Tap any name for details" : "Tap a name for details"}
        </Text>
      )}
    </View>
  );
}

// --- pieces ------------------------------------------------------------------

function toneColor(tone: SegmentTone): string {
  if (tone === "highlight") return colors.coral;
  if (tone === "placeholder") return colors.sand;
  return colors.mist;
}

function ruleColor(line: BracketLine): string {
  if (line.state === "placeholder") return colors.sand;
  if (line.state === "champion" || line.highlighted) return colors.coral;
  return colors.mist;
}

function nameStyle(line: BracketLine) {
  switch (line.state) {
    case "winner":
      return line.highlighted ? styles.nameWinnerHighlighted : styles.nameWinner;
    case "loser":
      return styles.nameLoser;
    case "champion":
      return styles.nameChampion;
    case "pending":
    default:
      return styles.namePending;
  }
}

function NameLine({
  line,
  index,
  fontSize,
  maxLines,
  selected,
  onPress,
}: {
  line: BracketLine;
  index: number;
  fontSize: number;
  maxLines: number;
  selected: boolean;
  onPress?: () => void;
}) {
  const box = {
    left: line.x,
    top: line.y,
    width: line.width,
    height: line.height + RULE,
  };

  const inner = (
    <>
      <View style={[styles.nameBox, { height: line.height }, selected && styles.nameBoxSelected]}>
        {line.title !== null && (
          // A bracket column is only ~100pt wide, so anything the author
          // appended after a dash ("Title - a sentence about it") would just
          // push the name itself out of view. The sheet shows the name; the
          // tap-through detail below shows the entry in full.
          <Text style={[styles.name, { fontSize }, nameStyle(line)]} numberOfLines={maxLines}>
            {splitTitle(line.title).name}
          </Text>
        )}
      </View>
      <View style={[styles.rule, { backgroundColor: ruleColor(line) }]} />
    </>
  );

  // The just-decided round fades in name by name.
  const body = line.highlighted ? (
    <Animated.View
      entering={FadeIn.duration(350).delay(60 + index * 35)}
      style={StyleSheet.absoluteFill}
    >
      {inner}
    </Animated.View>
  ) : (
    inner
  );

  if (!onPress) {
    return <View style={[styles.lineBox, styles.inert, box]}>{body}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.lineBox, box, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={line.title ?? undefined}
    >
      {body}
    </Pressable>
  );
}

function MatchupDetail({
  entry,
  showBreakdown,
  onClose,
}: {
  entry: MatchupEntry;
  showBreakdown: boolean;
  onClose: () => void;
}) {
  const { matchup: m, round, isFinal } = entry;
  const label = isFinal ? "FINAL" : `ROUND ${round}`;
  const decided = !!m.winner;
  const winnerIsA = decided && m.winner?.id === m.itemA?.id;
  const winnerIsB = decided && m.winner?.id === m.itemB?.id;
  const breakdown =
    showBreakdown && m.voteBreakdown && m.voteBreakdown.length > 0 ? m.voteBreakdown : null;

  const sideStyle = (isWinner: boolean) =>
    !decided ? styles.detailPending : isWinner ? styles.detailWinner : styles.detailLoser;

  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.detail}>
      <View style={styles.detailHeader}>
        <Text style={styles.detailLabel}>
          {label}
          {m.isBye ? " · BYE" : !decided ? " · UP NEXT" : ""}
        </Text>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Text style={styles.detailClose}>✕</Text>
        </Pressable>
      </View>

      {m.isBye ? (
        <Text style={styles.detailByeText}>
          <Text style={styles.detailWinner}>{m.itemA?.title ?? "?"}</Text> advanced without a
          matchup
        </Text>
      ) : (
        <View style={styles.detailPair}>
          <View style={styles.detailRow}>
            <Text style={[styles.detailMark, winnerIsA && styles.detailMarkWinner]}>
              {winnerIsA ? "✓" : " "}
            </Text>
            <Text style={[styles.detailSide, sideStyle(winnerIsA)]}>{m.itemA?.title ?? "?"}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={[styles.detailMark, winnerIsB && styles.detailMarkWinner]}>
              {winnerIsB ? "✓" : " "}
            </Text>
            <Text style={[styles.detailSide, sideStyle(winnerIsB)]}>{m.itemB?.title ?? "?"}</Text>
          </View>
        </View>
      )}

      {m.decidedByTiebreak && <Text style={styles.tiebreak}>split decision · coin flip</Text>}

      {breakdown && (
        <View style={styles.breakdown}>
          {breakdown.map((v, i) => {
            const pickedTitle =
              v.pickedItemId === m.itemA?.id
                ? m.itemA?.title
                : v.pickedItemId === m.itemB?.id
                  ? m.itemB?.title
                  : "?";
            return (
              <Text key={i} style={[styles.breakdownLine, v.isYou && styles.breakdownMe]}>
                {v.voterName}
                {v.isYou ? " (you)" : ""} → {pickedTitle}
              </Text>
            );
          })}
        </View>
      )}
    </Animated.View>
  );
}

// --- styles ------------------------------------------------------------------

const styles = StyleSheet.create({
  columnLabel: {
    position: "absolute",
    top: 0,
    ...typography.tiny,
    color: colors.mist,
    letterSpacing: 1,
  },
  columnLabelHighlighted: {
    color: colors.coral,
  },
  columnLabelChampion: {
    color: colors.coral,
  },
  segment: {
    position: "absolute",
    pointerEvents: "none",
  },
  marker: {
    position: "absolute",
    pointerEvents: "none",
    backgroundColor: colors.amber,
    borderWidth: 1.5,
    borderColor: colors.warmWhite,
  },
  lineBox: {
    position: "absolute",
  },
  inert: {
    pointerEvents: "none",
  },
  nameBox: {
    justifyContent: "flex-end",
    paddingHorizontal: 3,
    paddingBottom: 2,
    borderRadius: radius.sm,
  },
  nameBoxSelected: {
    backgroundColor: colors.coralLight,
  },
  rule: {
    height: RULE,
    width: "100%",
  },
  name: {
    lineHeight: undefined,
  },
  nameWinner: {
    color: colors.charcoal,
    fontWeight: "700",
  },
  nameWinnerHighlighted: {
    color: colors.coral,
    fontWeight: "700",
  },
  nameLoser: {
    color: colors.mist,
    textDecorationLine: "line-through",
  },
  namePending: {
    color: colors.slate,
    fontWeight: "500",
  },
  nameChampion: {
    color: colors.coral,
    fontWeight: "800",
  },
  hint: {
    ...typography.caption,
    color: colors.mist,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  detail: {
    marginTop: spacing.md,
    backgroundColor: colors.warmWhite,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    ...shadows.soft,
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailLabel: {
    ...typography.tiny,
    color: colors.mist,
    letterSpacing: 1,
  },
  detailClose: {
    ...typography.caption,
    color: colors.mist,
    paddingHorizontal: 4,
  },
  detailPair: {
    gap: 2,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  detailMark: {
    ...typography.bodyBold,
    width: 18,
    color: colors.mist,
  },
  detailMarkWinner: {
    color: colors.coral,
  },
  detailSide: {
    ...typography.body,
    flex: 1,
  },
  detailWinner: {
    color: colors.charcoal,
    fontWeight: "700",
  },
  detailLoser: {
    color: colors.mist,
    textDecorationLine: "line-through",
  },
  detailPending: {
    color: colors.slate,
    fontWeight: "500",
  },
  detailByeText: {
    ...typography.body,
    color: colors.slate,
  },
  tiebreak: {
    ...typography.caption,
    color: colors.amber,
    fontStyle: "italic",
  },
  breakdown: {
    marginTop: spacing.xs,
    backgroundColor: colors.sandLight,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: 2,
  },
  breakdownLine: {
    ...typography.caption,
    color: colors.slate,
  },
  breakdownMe: {
    color: colors.coral,
    fontWeight: "700",
  },
});
