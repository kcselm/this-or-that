import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getResults, type RevealedResults } from "../../../lib/api";
import { getVoterId, clearActiveRoom, getSavedResult, saveResult } from "../../../lib/storage";
import { useNextRound } from "../../../lib/useNextRound";
import VoteResults from "../../../components/results/VoteResults";
import RankResults from "../../../components/results/RankResults";
import BracketResults from "../../../components/results/BracketResults";
import MltResults from "../../../components/results/MltResults";
import TierResults from "../../../components/results/TierResults";
import { resultStyles } from "../../../components/results/styles";
import { colors, spacing, radius, typography } from "../../../lib/theme";

export default function ResultsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // `saved=1` opens a snapshot from Past Results instead of the live room,
  // which may have expired or been closed since.
  const { code, name, saved } = useLocalSearchParams<{
    code: string;
    name?: string;
    saved?: string;
  }>();
  const fromHistory = saved === "1";
  const [data, setData] = useState<RevealedResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Only a live blind rank room can continue into another round. null while
  // we don't know the mode yet.
  const nextRound = useNextRound(
    code,
    name,
    fromHistory ? false : data ? data.mode === "rank" : null
  );

  const loadResults = async () => {
    setLoading(true);
    setError(null);
    if (fromHistory) {
      const entry = await getSavedResult(code);
      if (entry) setData(entry.data);
      else setError("These results are no longer saved on this device.");
      setLoading(false);
      return;
    }
    try {
      const voterId = await getVoterId();
      const res = await getResults(code, voterId);
      if (!res.revealed) {
        setError("Results aren't ready yet. Waiting for everyone to finish.");
      } else {
        // Keep a local copy — the room is deleted from the server after 48h.
        saveResult(code, res).catch(() => {});
        // Rank rooms may continue into another round — keep the rejoin
        // banner alive until the player actually leaves for home. Other
        // modes forget the room only once its results are actually shown —
        // clearing on mount destroyed the rejoin banner for live rooms
        // whenever this screen was reached early.
        if (res.mode !== "rank") clearActiveRoom();
        setData(res);
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // From Past Results, "home" means back to the history list, and leaving
  // mustn't touch the rejoin banner. A web refresh leaves nothing to go back
  // to, so fall back to the history screen itself.
  const homeLabel = fromHistory ? "Back to Past Results" : "Back to Home";
  const leave = async (clearRoom = false) => {
    if (fromHistory) {
      if (router.canGoBack()) router.back();
      else router.replace("/history");
      return;
    }
    if (clearRoom) await clearActiveRoom();
    router.replace("/");
  };

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
          style={({ pressed }) => [resultStyles.homeLink, pressed && { opacity: 0.6 }]}
          onPress={() => leave()}
        >
          <Text style={resultStyles.homeLinkText}>{homeLabel}</Text>
        </Pressable>
      </View>
    );
  }

  switch (data.mode) {
    case "vote":
      return <VoteResults data={data} homeLabel={homeLabel} onHome={() => leave()} />;
    case "rank":
      return (
        <RankResults
          data={data}
          homeLabel={homeLabel}
          onHome={() => leave(true)}
          nextRound={fromHistory ? undefined : nextRound}
        />
      );
    case "bracket":
      return <BracketResults data={data} homeLabel={homeLabel} onHome={() => leave()} />;
    case "mlt":
      return <MltResults data={data} homeLabel={homeLabel} onHome={() => leave(true)} />;
    case "tier":
      return <TierResults data={data} homeLabel={homeLabel} onHome={() => leave()} />;
  }
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.cream,
    padding: spacing.xl,
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
});
