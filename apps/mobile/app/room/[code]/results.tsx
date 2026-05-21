import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { getResults, type ResultsResponse } from "../../../lib/api";
import { getVoterId, clearActiveRoom } from "../../../lib/storage";
import RankPlayerCard from "../../../components/RankPlayerCard";
import BracketTree from "../../../components/BracketTree";
import MltRevealCard from "../../../components/MltRevealCard";
import { colors, spacing, radius, typography, shadows } from "../../../lib/theme";

type RevealedVoteResults = Extract<ResultsResponse, { revealed: true; results: any[] }>;
type RevealedRankResults = Extract<ResultsResponse, { revealed: true; mode: "rank" }>;
type RevealedBracketResults = Extract<ResultsResponse, { revealed: true; mode: "bracket" }>;
type RevealedMltResults = Extract<ResultsResponse, { revealed: true; mode: "mlt" }>;

const MEDAL_COLORS = [
  { bg: "#FFF4E3", border: "#FFB347", text: "#E09422" }, // gold
  { bg: "#F0F0F0", border: "#B0B0B0", text: "#808080" }, // silver
  { bg: "#FFF0E8", border: "#D4956A", text: "#B07840" }, // bronze
];

export default function ResultsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code } = useLocalSearchParams<{ code: string }>();
  const [voteData, setVoteData] = useState<RevealedVoteResults | null>(null);
  const [rankData, setRankData] = useState<RevealedRankResults | null>(null);
  const [bracketData, setBracketData] = useState<RevealedBracketResults | null>(null);
  const [mltData, setMltData] = useState<RevealedMltResults | null>(null);
  const [myVoterId, setMyVoterId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadResults = async () => {
    setLoading(true);
    setError(null);
    try {
      const voterId = await getVoterId();
      setMyVoterId(voterId);
      const res = await getResults(code);
      if (!res.revealed) {
        setError("Results aren't ready yet. Waiting for everyone to finish.");
      } else if ("mode" in res && res.mode === "rank") {
        setRankData(res);
      } else if ("mode" in res && res.mode === "bracket") {
        setBracketData(res as RevealedBracketResults);
      } else if ("mode" in res && res.mode === "mlt") {
        setMltData(res as RevealedMltResults);
      } else {
        setVoteData(res as RevealedVoteResults);
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadResults();
    clearActiveRoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.coral} />
        <Text style={styles.loadingText}>Loading results...</Text>
      </View>
    );
  }

  if (error || (!voteData && !rankData && !bracketData && !mltData)) {
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

  if (rankData) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: spacing.xxl }}>
        <Animated.Text entering={FadeInUp.duration(400)} style={styles.rankTopic}>
          {rankData.topic}
        </Animated.Text>
        <Text style={styles.rankMeta}>{rankData.players.length} players ranked</Text>
        <View style={styles.rankList}>
          {rankData.players.map((p, i) => (
            <Animated.View key={p.voterId} entering={FadeInDown.duration(400).delay(i * 80)}>
              <RankPlayerCard
                name={p.name}
                isYou={p.voterId === myVoterId}
                isCreator={p.isCreator}
                rankings={p.rankings}
              />
            </Animated.View>
          ))}
        </View>
        <Pressable
          style={({ pressed }) => [styles.homeLink, pressed && { opacity: 0.6 }]}
          onPress={() => router.replace("/")}
        >
          <Text style={styles.homeLinkText}>Back to Home</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (mltData) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.cream, paddingTop: insets.top }}>
        <MltResultsView
          data={mltData}
          onHome={async () => {
            await clearActiveRoom();
            router.replace("/");
          }}
        />
      </ScrollView>
    );
  }

  if (bracketData) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: spacing.xxl }}
      >
        <Animated.View entering={FadeInUp.duration(500).springify()} style={styles.winnerCard}>
          <Text style={styles.winnerLabel}>WINNER</Text>
          <Text style={styles.winnerTitle}>{bracketData.winner?.title ?? "—"}</Text>
        </Animated.View>

        <Animated.Text entering={FadeInDown.duration(400).delay(150)} style={styles.topic}>
          {bracketData.topic}
        </Animated.Text>
        <Animated.Text entering={FadeInDown.duration(400).delay(200)} style={styles.meta}>
          {bracketData.totalRounds} rounds · tap a matchup to see who voted
        </Animated.Text>

        <View style={{ marginTop: spacing.lg }}>
          <BracketTree
            rounds={bracketData.rounds}
            expandableBreakdowns
            myVoterId={myVoterId}
          />
        </View>

        <Pressable
          style={({ pressed }) => [styles.homeLink, pressed && { opacity: 0.6 }]}
          onPress={() => router.replace("/")}
        >
          <Text style={styles.homeLinkText}>Back to Home</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // Vote-mode results
  return renderVoteResults(voteData!, insets, router);
}

function renderVoteResults(
  data: RevealedVoteResults,
  insets: ReturnType<typeof useSafeAreaInsets>,
  router: ReturnType<typeof useRouter>
) {
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
  rankTopic: {
    ...typography.h1,
    color: colors.coral,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
  rankMeta: {
    ...typography.caption,
    color: colors.mist,
    textAlign: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  rankList: {
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
});

function MltResultsView({
  data,
  onHome,
}: {
  data: RevealedMltResults;
  onHome: () => void;
}) {
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

  if (phase === "reveal") {
    const current = data.prompts[promptIndex];
    return (
      <MltRevealCard
        key={current.itemId}
        promptText={current.text}
        promptIndex={promptIndex}
        total={data.prompts.length}
        tallies={current.tallies}
        winners={current.winners}
        onNext={handleNext}
      />
    );
  }

  // Leaderboard phase
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <View style={mltResultsStyles.leaderboardWrap}>
      <Text style={mltResultsStyles.title}>🏆 Superlatives</Text>
      {data.leaderboard.map((entry, i) => (
        <View key={entry.voterId} style={mltResultsStyles.row}>
          <Text style={mltResultsStyles.medal}>{medals[i] ?? "  "}</Text>
          <Text style={mltResultsStyles.name}>{entry.name}</Text>
          <Text style={mltResultsStyles.wins}>
            {entry.wins} {entry.wins === 1 ? "win" : "wins"}
          </Text>
        </View>
      ))}
      <Pressable style={mltResultsStyles.btn} onPress={handleReplay}>
        <Text style={mltResultsStyles.btnText}>Replay reveal</Text>
      </Pressable>
      <Pressable style={[mltResultsStyles.btn, mltResultsStyles.btnSecondary]} onPress={onHome}>
        <Text style={[mltResultsStyles.btnText, mltResultsStyles.btnTextSecondary]}>
          Back to home
        </Text>
      </Pressable>
    </View>
  );
}

const mltResultsStyles = StyleSheet.create({
  leaderboardWrap: { padding: spacing.xl, alignItems: "stretch" },
  title: { ...typography.h1, color: colors.charcoal, textAlign: "center", marginBottom: spacing.lg },
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
  btnText: { ...typography.h3, color: "#fff", fontWeight: "600" },
  btnTextSecondary: { color: colors.coral },
});
