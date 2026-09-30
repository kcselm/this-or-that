import { Fragment, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import type { DraftResults as DraftResultsData } from "../../lib/api";
import { getPlayerColor } from "../../lib/player-colors";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";
import { resultStyles, type ResultsViewProps } from "./styles";

const ORDER_NAMES = { snake: "Snake", circle: "Circle" } as const;

// Every player's list side by side, then the full pick log. There's no winner:
// arguing over whose list is best is the game.
export default function DraftResults({
  data,
  homeLabel,
  onHome,
}: ResultsViewProps<DraftResultsData>) {
  const insets = useSafeAreaInsets();
  const [showLog, setShowLog] = useState(false);

  // A force-reveal mid-draft leaves some lists short, so the log is built from
  // the picks that exist rather than assuming every player made every pick.
  const log = data.players
    .flatMap((p) => p.picks.map((pick) => ({ ...pick, name: p.name, seat: p.seat })))
    .sort((a, b) => a.pickIndex - b.pickIndex);

  const rounds = `${data.rounds} ${data.rounds === 1 ? "round" : "rounds"}`;
  const partial = data.picksMade < data.totalPicks;

  return (
    <ScrollView
      style={resultStyles.container}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: spacing.xxl }}
    >
      <View style={styles.column}>
        <Animated.Text entering={FadeInUp.duration(400)} style={styles.topic}>
          {data.topic}
        </Animated.Text>
        <Text style={resultStyles.meta}>
          {ORDER_NAMES[data.draftOrder]} draft · {rounds}
          {partial ? ` · ended after ${data.picksMade} of ${data.totalPicks} picks` : ""}
        </Text>

        <View style={styles.list}>
          {data.players.map((p, i) => {
            const color = getPlayerColor(p.seat);
            return (
              <Animated.View
                key={p.participantId}
                entering={FadeInDown.duration(400).delay(i * 80)}
                style={[styles.card, p.isYou && { borderColor: color.border }]}
              >
                <View style={styles.headerRow}>
                  <View style={[styles.swatch, { backgroundColor: color.base }]} />
                  <Text style={styles.name} numberOfLines={1}>
                    {p.isYou ? `${p.name} (You)` : p.name}
                  </Text>
                  {p.isCreator && (
                    <View style={styles.hostBadge}>
                      <Text style={styles.hostBadgeText}>HOST</Text>
                    </View>
                  )}
                </View>
                {p.picks.length === 0 ? (
                  <Text style={styles.empty}>No picks</Text>
                ) : (
                  p.picks.map((pick, n) => (
                    <View key={pick.pickIndex} style={styles.row}>
                      <View style={[styles.bubble, { backgroundColor: color.tint }]}>
                        <Text style={[styles.bubbleText, { color: color.base }]}>{n + 1}</Text>
                      </View>
                      <Text style={styles.pickTitle}>{pick.title}</Text>
                    </View>
                  ))
                )}
              </Animated.View>
            );
          })}
        </View>

        {log.length > 0 && (
          <View style={styles.logSection}>
            <Pressable
              style={({ pressed }) => [styles.logToggle, pressed && { opacity: 0.7 }]}
              onPress={() => setShowLog((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showLog }}
            >
              <Text style={styles.logToggleText}>Pick order</Text>
              <Text style={styles.logChevron}>{showLog ? "▲" : "▼"}</Text>
            </Pressable>
            {showLog && (
              <View style={styles.log}>
                {log.map((pick, i) => (
                  <Fragment key={pick.pickIndex}>
                    {(i === 0 || log[i - 1].round !== pick.round) && (
                      <Text style={styles.roundLabel}>Round {pick.round + 1}</Text>
                    )}
                    <Text style={styles.logRow}>
                      <Text style={styles.logNumber}>{pick.pickIndex + 1}. </Text>
                      <Text style={styles.logName}>{pick.name}</Text> — {pick.title}
                    </Text>
                  </Fragment>
                ))}
              </View>
            )}
          </View>
        )}

        <Pressable
          style={({ pressed }) => [
            resultStyles.homeButton,
            styles.homeButton,
            pressed && { opacity: 0.85 },
          ]}
          onPress={onHome}
          accessibilityRole="button"
        >
          <Text style={resultStyles.homeButtonText}>{homeLabel}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  column: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  topic: {
    ...typography.h1,
    color: colors.coral,
    textAlign: "center",
  },
  list: {
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
    borderWidth: 2,
    borderColor: "transparent",
    ...shadows.soft,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  name: {
    ...typography.bodyBold,
    color: colors.charcoal,
    flex: 1,
  },
  hostBadge: {
    backgroundColor: colors.amberLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  hostBadgeText: {
    ...typography.tiny,
    color: colors.amber,
    fontSize: 9,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 2,
  },
  bubble: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  bubbleText: {
    ...typography.caption,
    fontWeight: "700",
  },
  pickTitle: {
    ...typography.body,
    color: colors.charcoal,
    flex: 1,
  },
  empty: {
    ...typography.body,
    color: colors.mist,
    fontStyle: "italic",
  },
  logSection: {
    marginTop: spacing.xl,
    backgroundColor: colors.warmWhite,
    borderRadius: radius.lg,
    ...shadows.soft,
  },
  logToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
  },
  logToggleText: {
    ...typography.bodyBold,
    color: colors.charcoal,
  },
  logChevron: {
    ...typography.caption,
    color: colors.mist,
  },
  log: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  roundLabel: {
    ...typography.tiny,
    color: colors.mist,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.sand,
  },
  logRow: {
    ...typography.body,
    color: colors.charcoal,
  },
  logNumber: {
    color: colors.slate,
  },
  logName: {
    fontWeight: "600",
  },
  homeButton: {
    marginTop: spacing.xl,
  },
});
