import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { getResults, type ResultsResponse } from "../../../lib/api";
import { clearActiveRoom } from "../../../lib/storage";
import { colors, spacing, radius, typography, shadows } from "../../../lib/theme";

type RevealedResults = Extract<ResultsResponse, { revealed: true }>;

const MEDAL_COLORS = [
  { bg: "#FFF4E3", border: "#FFB347", text: "#E09422" }, // gold
  { bg: "#F0F0F0", border: "#B0B0B0", text: "#808080" }, // silver
  { bg: "#FFF0E8", border: "#D4956A", text: "#B07840" }, // bronze
];

export default function ResultsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code } = useLocalSearchParams<{ code: string }>();
  const [data, setData] = useState<RevealedResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadResults = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getResults(code);
      if (res.revealed) {
        setData(res);
      } else {
        setError("Results aren't ready yet. Waiting for everyone to finish.");
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadResults();
    clearActiveRoom();
  }, [code]);

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.coral} />
        <Text style={styles.loadingText}>Loading results...</Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{error ?? "Results not available yet"}</Text>
        <Pressable
          style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
          onPress={loadResults}
        >
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.homeLink, pressed && { opacity: 0.6 }]}
          onPress={() => router.replace("/")}
        >
          <Text style={styles.homeLinkText}>Back to Home</Text>
        </Pressable>
      </View>
    );
  }

  const winner = data.results[0];

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      {/* Winner spotlight */}
      <Animated.View entering={FadeInUp.duration(500).springify()} style={styles.winnerCard}>
        <Text style={styles.winnerLabel}>TOP PICK</Text>
        <Text style={styles.winnerTitle}>{winner?.title}</Text>
        <View style={styles.winnerStats}>
          <Text style={styles.winnerPercent}>{winner?.yesPercentage}%</Text>
          <Text style={styles.winnerPercentLabel}>yes</Text>
        </View>
      </Animated.View>

      <Animated.Text entering={FadeInDown.duration(400).delay(200)} style={styles.topic}>
        {data.topic}
      </Animated.Text>
      <Animated.Text entering={FadeInDown.duration(400).delay(300)} style={styles.meta}>
        {data.totalVoters} voters
      </Animated.Text>

      <FlatList
        data={data.results}
        keyExtractor={(item) => item.itemId}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => {
          const medal = index < 3 ? MEDAL_COLORS[index] : null;
          const barColor =
            item.yesPercentage >= 70
              ? colors.teal
              : item.yesPercentage >= 40
              ? colors.amber
              : colors.coral;

          return (
            <Animated.View
              entering={FadeInDown.duration(400).delay(300 + index * 80)}
              style={styles.resultRow}
            >
              <View
                style={[
                  styles.rankBadge,
                  medal
                    ? { backgroundColor: medal.bg, borderColor: medal.border, borderWidth: 2 }
                    : { backgroundColor: colors.sandLight },
                ]}
              >
                <Text
                  style={[
                    styles.rankText,
                    medal ? { color: medal.text } : { color: colors.slate },
                  ]}
                >
                  {index + 1}
                </Text>
              </View>
              <View style={styles.resultInfo}>
                <Text style={styles.resultTitle}>{item.title}</Text>
                <View style={styles.barContainer}>
                  <View
                    style={[
                      styles.barFill,
                      { width: `${item.yesPercentage}%`, backgroundColor: barColor },
                    ]}
                  />
                </View>
                <Text style={styles.resultMeta}>
                  {item.yesPercentage}% yes · {item.yesCount} yes, {item.noCount} no
                </Text>
              </View>
            </Animated.View>
          );
        }}
      />

      <Animated.View entering={FadeInDown.duration(400).delay(600)}>
        <Pressable
          style={({ pressed }) => [styles.homeButton, pressed && styles.homeButtonPressed]}
          onPress={() => router.replace("/")}
        >
          <Text style={styles.homeButtonText}>Back to Home</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
    padding: spacing.xl,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.cream,
    padding: spacing.xl,
  },
  winnerCard: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: "center",
    marginBottom: spacing.lg,
    borderWidth: 2,
    borderColor: colors.amber,
    ...shadows.card,
  },
  winnerLabel: {
    ...typography.tiny,
    color: colors.amber,
    marginBottom: spacing.sm,
  },
  winnerTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: colors.charcoal,
    textAlign: "center",
    letterSpacing: -0.5,
    marginBottom: spacing.md,
  },
  winnerStats: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.xs,
  },
  winnerPercent: {
    fontSize: 36,
    fontWeight: "800",
    color: colors.teal,
  },
  winnerPercentLabel: {
    ...typography.body,
    color: colors.teal,
    fontWeight: "600",
  },
  topic: {
    ...typography.h3,
    color: colors.charcoal,
    textAlign: "center",
  },
  meta: {
    ...typography.caption,
    color: colors.mist,
    textAlign: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  list: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.warmWhite,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.soft,
  },
  rankBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  rankText: {
    fontWeight: "800",
    fontSize: 14,
  },
  resultInfo: {
    flex: 1,
  },
  resultTitle: {
    ...typography.bodyBold,
    color: colors.charcoal,
    marginBottom: spacing.xs,
  },
  barContainer: {
    height: 8,
    backgroundColor: colors.sand,
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: spacing.xs,
  },
  barFill: {
    height: "100%",
    borderRadius: 4,
  },
  resultMeta: {
    ...typography.caption,
    color: colors.mist,
    fontSize: 12,
  },
  loadingText: {
    ...typography.body,
    color: colors.mist,
    marginTop: spacing.md,
  },
  errorText: {
    ...typography.body,
    color: colors.error,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  retryButton: {
    backgroundColor: colors.coral,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
  },
  retryButtonPressed: {
    backgroundColor: colors.coralDark,
  },
  retryText: {
    color: colors.warmWhite,
    ...typography.bodyBold,
  },
  homeLink: {
    paddingVertical: spacing.sm,
  },
  homeLinkText: {
    ...typography.body,
    color: colors.coral,
  },
  homeButton: {
    backgroundColor: colors.coral,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    marginTop: spacing.sm,
    ...shadows.button,
  },
  homeButtonPressed: {
    backgroundColor: colors.coralDark,
    transform: [{ scale: 0.98 }],
  },
  homeButtonText: {
    color: colors.warmWhite,
    fontSize: 18,
    fontWeight: "700",
  },
});
