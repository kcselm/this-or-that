import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  useWindowDimensions,
} from "react-native";
import { showAlert } from "../../../lib/alert";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn } from "react-native-reanimated";
import MatchupCard from "../../../components/MatchupCard";
import {
  getRoom,
  getBracket,
  submitMatchupVote,
  ApiError,
  type BracketMatchup,
} from "../../../lib/api";
import { getVoterId } from "../../../lib/storage";
import { matchupLayout } from "../../../lib/matchup-layout";
import { colors, spacing, typography } from "../../../lib/theme";

export default function BracketScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  // Side by side, each card only gets a sliver of a phone screen and long
  // titles get clipped. Below tablet width the pair stacks instead, so each
  // card spans the full column. The card size goes to the cards themselves so
  // they can fit their type to it.
  const { stacked, card } = matchupLayout(window.width, window.height, insets.top);
  const { code, name, isCreator } = useLocalSearchParams<{
    code: string;
    name: string;
    isCreator?: string;
  }>();

  const [topic, setTopic] = useState("");
  const [currentRound, setCurrentRound] = useState<number | null>(null);
  const [totalRounds, setTotalRounds] = useState(0);
  const [pending, setPending] = useState<BracketMatchup[]>([]); // current-round matchups I haven't voted on
  const [doneInRound, setDoneInRound] = useState(0); // total real matchups already voted on
  const [totalInRound, setTotalInRound] = useState(0); // total real matchups this round
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const navigateToWaiting = (lastVotedRound: number) => {
    router.replace({
      pathname: "/room/[code]/waiting",
      params: {
        code,
        name,
        isCreator: isCreator ?? "false",
        lastVotedRound: String(lastVotedRound),
      },
    });
  };

  const loadInitial = async () => {
    setLoading(true);
    setError(null);
    try {
      const voterId = await getVoterId();
      const room = await getRoom(code, voterId);
      if (room.mode !== "bracket") {
        setError("This room isn't a bracket room.");
        setLoading(false);
        return;
      }
      setTopic(room.topic);

      if (room.status === "revealed") {
        // Skip straight to results.
        router.replace({ pathname: "/room/[code]/results", params: { code, name } });
        return;
      }

      const bracket = await getBracket(code, voterId);
      setCurrentRound(bracket.currentRound);
      setTotalRounds(bracket.totalRounds);

      if (bracket.currentRound === null) {
        // Revealed between getRoom and getBracket.
        router.replace({ pathname: "/room/[code]/results", params: { code, name } });
        return;
      }

      const round = bracket.rounds.find((r) => r.round === bracket.currentRound);
      const realMatchups = round?.matchups.filter((m) => !m.isBye) ?? [];
      const myVotedIds = new Set(Object.keys(bracket.myVotes));
      const unvoted = realMatchups.filter((m) => !myVotedIds.has(m.id));

      setTotalInRound(realMatchups.length);
      setDoneInRound(realMatchups.length - unvoted.length);
      setPending(unvoted);

      if (unvoted.length === 0) {
        // I'm done with this round — go to waiting.
        navigateToWaiting(bracket.currentRound);
        return;
      }
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the bracket.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const handlePick = async (pickedItemId: string) => {
    if (submitting || pending.length === 0 || !currentRound) return;
    setSubmitting(true);
    setSelectedItemId(pickedItemId);
    const matchup = pending[0];

    try {
      const voterId = await getVoterId();
      await submitMatchupVote(code, {
        matchupId: matchup.id,
        voterId,
        voterName: name,
        pickedItemId,
      });

      // Brief delay to let the selection animation play.
      await new Promise((r) => setTimeout(r, 250));

      const remaining = pending.slice(1);
      setDoneInRound((c) => c + 1);
      setSelectedItemId(null);

      if (remaining.length === 0) {
        // That was the last matchup in this round. Hop to waiting.
        navigateToWaiting(currentRound);
        return;
      }

      setPending(remaining);
    } catch (e: any) {
      setSelectedItemId(null);
      showAlert("Error", e instanceof ApiError ? e.message : "Couldn't submit your vote.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.coral} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={loadInitial}>
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  const current = pending[0];
  if (!current) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.coral} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.topic} numberOfLines={1}>{topic}</Text>
        <Text style={styles.progress}>
          Round {currentRound}/{totalRounds} · Matchup {doneInRound + 1} of {totalInRound}
        </Text>
      </View>

      <Animated.View
        key={current.id}
        entering={FadeIn.duration(200)}
        style={[styles.matchupArea, stacked && styles.matchupAreaStacked]}
      >
        <MatchupCard
          title={current.itemA?.title ?? "?"}
          available={card}
          selected={selectedItemId === current.itemA?.id}
          disabled={submitting}
          onPress={() => current.itemA && handlePick(current.itemA.id)}
        />
        <Text style={[styles.vs, stacked && styles.vsStacked]}>vs</Text>
        <MatchupCard
          title={current.itemB?.title ?? "?"}
          available={card}
          selected={selectedItemId === current.itemB?.id}
          disabled={submitting}
          onPress={() => current.itemB && handlePick(current.itemB.id)}
        />
      </Animated.View>

      {doneInRound === 0 && (
        <Text style={styles.hint}>Tap a card to pick a winner</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.cream,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
    gap: spacing.lg,
  },
  header: {
    marginBottom: spacing.lg,
    gap: 4,
  },
  topic: {
    ...typography.h2,
    color: colors.charcoal,
  },
  progress: {
    ...typography.bodyBold,
    color: colors.coral,
  },
  matchupArea: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.md,
  },
  matchupAreaStacked: {
    flexDirection: "column",
  },
  vs: {
    ...typography.h2,
    color: colors.mist,
    alignSelf: "center",
    paddingHorizontal: 4,
  },
  vsStacked: {
    paddingHorizontal: 0,
    paddingVertical: 2,
  },
  hint: {
    ...typography.body,
    color: colors.mist,
    textAlign: "center",
    marginTop: spacing.md,
  },
  errorText: {
    ...typography.body,
    color: colors.error,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: colors.coral,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 16,
  },
  retryText: {
    color: colors.warmWhite,
    ...typography.bodyBold,
  },
});
