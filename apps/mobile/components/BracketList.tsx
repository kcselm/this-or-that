import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import type { BracketRound } from "../lib/api";
import { colors, spacing, radius, typography, shadows } from "../lib/theme";

type Props = {
  rounds: BracketRound[];
  expandableBreakdowns?: boolean; // true on final results, false on between-round
};

export default function BracketList({ rounds, expandableBreakdowns }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <View style={styles.container}>
      {rounds.map((r) => (
        <View key={r.round} style={styles.roundBlock}>
          <Text style={styles.roundLabel}>ROUND {r.round}</Text>
          <View style={styles.matchupList}>
            {r.matchups.map((m) => {
              const winnerIsA = m.winner?.id && m.winner.id === m.itemA?.id;
              const winnerIsB = m.winner?.id && m.winner.id === m.itemB?.id;
              const expandable = expandableBreakdowns && !!m.voteBreakdown && !m.isBye;
              const isExpanded = expandable && expandedId === m.id;

              return (
                <View key={m.id} style={styles.matchupRow}>
                  <Pressable
                    onPress={() => expandable && setExpandedId(isExpanded ? null : m.id)}
                    disabled={!expandable}
                    style={({ pressed }) => [
                      styles.matchupCard,
                      pressed && expandable && { opacity: 0.85 },
                    ]}
                  >
                    {m.isBye ? (
                      <View style={styles.byeRow}>
                        <Text style={[styles.side, styles.byeText]}>BYE</Text>
                        <Text style={styles.arrow}>→</Text>
                        <Text style={[styles.side, styles.winnerSide]} numberOfLines={1}>
                          {m.itemA?.title ?? "?"}
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.pair}>
                        <Text
                          style={[styles.side, winnerIsA ? styles.winnerSide : styles.loserSide]}
                          numberOfLines={1}
                        >
                          {m.itemA?.title ?? "?"}
                        </Text>
                        <Text style={styles.vsLabel}>vs</Text>
                        <Text
                          style={[styles.side, winnerIsB ? styles.winnerSide : styles.loserSide]}
                          numberOfLines={1}
                        >
                          {m.itemB?.title ?? "?"}
                        </Text>
                      </View>
                    )}
                    {m.decidedByTiebreak && (
                      <Text style={styles.tiebreakLabel}>split decision · coin flip</Text>
                    )}
                  </Pressable>

                  {isExpanded && m.voteBreakdown && (
                    <View style={styles.breakdown}>
                      {m.voteBreakdown.map((v, i) => {
                        const pickedTitle =
                          v.pickedItemId === m.itemA?.id
                            ? m.itemA?.title
                            : v.pickedItemId === m.itemB?.id
                            ? m.itemB?.title
                            : "?";
                        const isMe = v.isYou;
                        return (
                          <Text key={i} style={[styles.breakdownLine, isMe && styles.breakdownMe]}>
                            {v.voterName}{isMe ? " (you)" : ""} → {pickedTitle}
                          </Text>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  roundBlock: {
    gap: spacing.sm,
  },
  roundLabel: {
    ...typography.tiny,
    color: colors.mist,
    letterSpacing: 1,
  },
  matchupList: {
    gap: spacing.sm,
  },
  matchupRow: {
    gap: spacing.xs,
  },
  matchupCard: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadows.soft,
  },
  pair: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  byeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  arrow: {
    ...typography.body,
    color: colors.mist,
  },
  side: {
    ...typography.body,
    flex: 1,
  },
  winnerSide: {
    color: colors.charcoal,
    fontWeight: "700",
  },
  loserSide: {
    color: colors.mist,
    textDecorationLine: "line-through",
  },
  byeText: {
    color: colors.mist,
    flex: 0,
    fontStyle: "italic",
  },
  vsLabel: {
    ...typography.caption,
    color: colors.mist,
    flex: 0,
  },
  tiebreakLabel: {
    ...typography.caption,
    color: colors.amber,
    marginTop: spacing.xs,
    fontStyle: "italic",
  },
  breakdown: {
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
