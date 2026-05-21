import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing,
} from "react-native-reanimated";
import { colors, spacing, radius, typography, shadows } from "../lib/theme";

type Tally = { targetVoterId: string; name: string; count: number };
type Winner = { voterId: string; name: string };

type Props = {
  promptText: string;
  promptIndex: number;
  total: number;
  tallies: Tally[];
  winners: Winner[];
  onNext: () => void;
};

export default function MltRevealCard({
  promptText,
  promptIndex,
  total,
  tallies,
  winners,
  onNext,
}: Props) {
  const [revealed, setRevealed] = useState(false);
  const flip = useSharedValue(0);

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ rotateY: `${interpolate(flip.value, [0, 1], [0, 180])}deg` }],
    opacity: interpolate(flip.value, [0, 0.5, 0.5], [1, 1, 0]),
  }));

  const backStyle = useAnimatedStyle(() => ({
    transform: [{ rotateY: `${interpolate(flip.value, [0, 1], [180, 360])}deg` }],
    opacity: interpolate(flip.value, [0.5, 0.5, 1], [0, 1, 1]),
  }));

  const doReveal = () => {
    setRevealed(true);
    flip.value = withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) });
  };

  // Non-zero tallies first, alphabetical secondary (server already sorts; reuse)
  const winnerNames = winners.map((w) => w.name).join(" & ");
  const winnerCount = winners.length > 0 ? tallies[0].count : 0;
  const runnersUp = tallies.filter((t) => !winners.some((w) => w.voterId === t.targetVoterId));

  return (
    <View style={styles.wrapper}>
      <Text style={styles.progress}>
        Prompt {promptIndex + 1} of {total}
      </Text>

      <Text style={styles.promptText}>{promptText}</Text>

      <Pressable onPress={revealed ? undefined : doReveal} style={styles.cardArea}>
        <Animated.View style={[styles.face, styles.front, frontStyle]}>
          <Text style={styles.coveredLabel}>Tap to reveal</Text>
        </Animated.View>
        <Animated.View style={[styles.face, styles.back, backStyle]}>
          {winners.length === 0 ? (
            <Text style={styles.noVotes}>No votes cast</Text>
          ) : (
            <>
              <Text style={styles.crown}>
                {winners.length > 1 ? "👑 Tied" : "👑"}
              </Text>
              <Text style={styles.winnerName}>{winnerNames}</Text>
              <Text style={styles.winnerVotes}>
                {winnerCount} {winnerCount === 1 ? "vote" : "votes"}
              </Text>
              {runnersUp.length > 0 && (
                <Text style={styles.runners}>
                  {runnersUp.map((t) => `${t.name} ${t.count}`).join(" · ")}
                </Text>
              )}
            </>
          )}
        </Animated.View>
      </Pressable>

      {revealed && (
        <Pressable style={styles.nextBtn} onPress={onNext}>
          <Text style={styles.nextText}>Next →</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { padding: spacing.xl, alignItems: "stretch" },
  progress: { ...typography.body, color: colors.slate, textAlign: "center", marginBottom: spacing.sm },
  promptText: {
    ...typography.h2,
    color: colors.charcoal,
    textAlign: "center",
    marginBottom: spacing.xl,
  },
  cardArea: {
    height: 240,
    position: "relative",
  },
  face: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.warmWhite,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.sand,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    backfaceVisibility: "hidden",
    ...shadows.soft,
  },
  front: {},
  back: { borderColor: colors.coral },
  coveredLabel: { ...typography.h3, color: colors.slate },
  crown: { fontSize: 30, marginBottom: spacing.xs },
  winnerName: { ...typography.h1, color: colors.charcoal, textAlign: "center" },
  winnerVotes: { ...typography.body, color: colors.slate, marginTop: spacing.xs },
  runners: {
    ...typography.body,
    color: colors.slate,
    marginTop: spacing.md,
    textAlign: "center",
  },
  noVotes: { ...typography.body, color: colors.slate },
  nextBtn: {
    marginTop: spacing.xl,
    alignSelf: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.coral,
    borderRadius: radius.md,
  },
  nextText: { ...typography.h3, color: "#fff", fontWeight: "600" },
});
