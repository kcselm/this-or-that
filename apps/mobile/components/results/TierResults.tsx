import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Tier, TierResults as TierResultsData } from "../../lib/api";
import { TIERS } from "../../lib/tiers";
import { colors, spacing, radius, typography } from "../../lib/theme";
import TierBoard from "../TierBoard";
import { resultStyles, type ResultsViewProps } from "./styles";

// A Consensus board averaged from everyone, plus a tab per player's board.
export default function TierResults({ data, homeLabel, onHome }: ResultsViewProps<TierResultsData>) {
  const insets = useSafeAreaInsets();
  // Tab 0 = Consensus; tabs 1..N = each player's board.
  const [tab, setTab] = useState(0);

  // The server pins "You" first when a voterId is sent; keep it stable here too.
  const players = [...data.players].sort((a, b) =>
    a.isYou === b.isYou ? 0 : a.isYou ? -1 : 1
  );

  const tabs = [
    { key: "consensus", label: "Consensus" },
    ...players.map((p) => ({ key: p.participantId, label: p.isYou ? "You" : p.name })),
  ];

  const byTier = (placements: { title: string; tier: Tier }[]) =>
    TIERS.map((tier) => ({
      tier,
      titles: placements.filter((p) => p.tier === tier).map((p) => p.title),
    }));

  const activePlayer = tab === 0 ? null : players[tab - 1];
  const rows = activePlayer
    ? byTier(activePlayer.placements)
    : TIERS.map((tier) => ({
        tier,
        titles: data.consensus.find((r) => r.tier === tier)?.items.map((i) => i.title) ?? [],
      }));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.cream }}
      contentContainerStyle={{ paddingTop: insets.top + 16, padding: spacing.xl, paddingBottom: spacing.xxl }}
    >
      <Text style={styles.topic}>{data.topic}</Text>
      <Text style={styles.meta}>
        {activePlayer ? `${tabs[tab].label}'s board` : "Averaged from every board"}
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {tabs.map((t, i) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(i)}
            style={[styles.tab, tab === i && styles.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === i }}
          >
            <Text style={[styles.tabText, tab === i && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={{ marginTop: spacing.lg }}>
        <TierBoard rows={rows} />
      </View>

      <Pressable
        style={({ pressed }) => [resultStyles.homeButton, styles.homeButton, pressed && { opacity: 0.85 }]}
        onPress={onHome}
      >
        <Text style={resultStyles.homeButtonText}>{homeLabel}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  topic: {
    ...typography.h1,
    color: colors.coral,
    textAlign: "center",
  },
  meta: {
    ...typography.caption,
    color: colors.mist,
    textAlign: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  tabs: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.warmWhite,
    borderWidth: 1,
    borderColor: colors.sand,
  },
  tabActive: {
    backgroundColor: colors.coral,
    borderColor: colors.coral,
  },
  tabText: {
    ...typography.caption,
    color: colors.slate,
    fontWeight: "700",
  },
  tabTextActive: {
    color: colors.warmWhite,
  },
  homeButton: {
    marginTop: spacing.xl,
  },
});
