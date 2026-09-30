import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import type { VoteResults as VoteResultsData } from "../../lib/api";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";
import { resultStyles, type ResultsViewProps } from "./styles";

const MEDAL_COLORS = [
  { bg: "#FFF4E3", border: "#FFB347", text: "#E09422" }, // gold
  { bg: "#F0F0F0", border: "#B0B0B0", text: "#808080" }, // silver
  { bg: "#FFF0E8", border: "#D4956A", text: "#B07840" }, // bronze
];

export default function VoteResults({
  data,
  homeLabel,
  onHome,
}: ResultsViewProps<VoteResultsData>) {
  const insets = useSafeAreaInsets();
  const winner = data.results[0];

  return (
    <View style={[resultStyles.container, { paddingTop: insets.top + 16 }]}>
      {/* Winner spotlight */}
      <Animated.View entering={FadeInUp.duration(500).springify()} style={resultStyles.winnerCard}>
        <Text style={resultStyles.winnerLabel}>TOP PICK</Text>
        <Text style={resultStyles.winnerTitle}>{winner?.title}</Text>
        <View style={styles.winnerStats}>
          <Text style={styles.winnerPercent}>{winner?.yesPercentage}%</Text>
          <Text style={styles.winnerPercentLabel}>yes</Text>
        </View>
      </Animated.View>

      <Animated.Text entering={FadeInDown.duration(400).delay(200)} style={resultStyles.topic}>
        {data.topic}
      </Animated.Text>
      <Animated.Text entering={FadeInDown.duration(400).delay(300)} style={resultStyles.meta}>
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
                <Text style={[styles.rankText, { color: medal ? medal.text : colors.slate }]}>
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
          style={({ pressed }) => [
            resultStyles.homeButton,
            pressed && resultStyles.homeButtonPressed,
          ]}
          onPress={onHome}
        >
          <Text style={resultStyles.homeButtonText}>{homeLabel}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
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
});
