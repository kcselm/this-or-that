import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MltResults as MltResultsData } from "../../lib/api";
import { colors, spacing, radius, typography } from "../../lib/theme";
import MltRevealCard from "../MltRevealCard";
import type { ResultsViewProps } from "./styles";

const MEDALS = ["🥇", "🥈", "🥉"];

// Prompts are revealed one at a time, then the superlatives leaderboard.
export default function MltResults({ data, homeLabel, onHome }: ResultsViewProps<MltResultsData>) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<"reveal" | "leaderboard">("reveal");
  const [promptIndex, setPromptIndex] = useState(0);

  const handleNext = () => {
    if (promptIndex + 1 < data.prompts.length) {
      setPromptIndex((i) => i + 1);
    } else {
      setPhase("leaderboard");
    }
  };

  const handleReplay = () => {
    setPromptIndex(0);
    setPhase("reveal");
  };

  const current = data.prompts[promptIndex];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.cream, paddingTop: insets.top }}>
      {phase === "reveal" ? (
        <MltRevealCard
          key={current.itemId}
          promptText={current.text}
          promptIndex={promptIndex}
          total={data.prompts.length}
          tallies={current.tallies}
          winners={current.winners}
          onNext={handleNext}
        />
      ) : (
        <View style={styles.leaderboardWrap}>
          <Text style={styles.title}>🏆 Superlatives</Text>
          {data.leaderboard.map((entry, i) => (
            <View key={entry.participantId} style={styles.row}>
              <Text style={styles.medal}>{MEDALS[i] ?? "  "}</Text>
              <Text style={styles.name}>{entry.name}</Text>
              <Text style={styles.wins}>
                {entry.wins} {entry.wins === 1 ? "win" : "wins"}
              </Text>
            </View>
          ))}
          <Pressable style={styles.btn} onPress={handleReplay} accessibilityRole="button">
            <Text style={styles.btnText}>Replay reveal</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnSecondary]}
            onPress={onHome}
            accessibilityRole="button"
          >
            <Text style={[styles.btnText, styles.btnTextSecondary]}>{homeLabel}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  leaderboardWrap: { padding: spacing.xl, alignItems: "stretch" },
  title: {
    ...typography.h1,
    color: colors.charcoal,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.warmWhite,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.sand,
  },
  medal: { ...typography.h2, width: 40 },
  name: { ...typography.h3, flex: 1, color: colors.charcoal },
  wins: { ...typography.body, color: colors.slate },
  btn: {
    marginTop: spacing.lg,
    backgroundColor: colors.coral,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  btnSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.coral },
  btnText: { ...typography.h3, color: colors.warmWhite, fontWeight: "600" },
  btnTextSecondary: { color: colors.coral },
});
