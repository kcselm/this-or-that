import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { showAlert } from "../../../lib/alert";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn } from "react-native-reanimated";
import RankCard from "../../../components/RankCard";
import RankSlot, { type SlotRect } from "../../../components/RankSlot";
import {
  getRoom,
  getNextRankItem,
  submitRanking,
  ApiError,
} from "../../../lib/api";
import { getVoterId } from "../../../lib/storage";
import { colors, spacing, typography } from "../../../lib/theme";

type CurrentItem = { id: string; title: string } | null;

export default function RankScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code, name, isCreator } = useLocalSearchParams<{
    code: string;
    name: string;
    isCreator?: string;
  }>();

  const [topic, setTopic] = useState<string>("");
  const [current, setCurrent] = useState<CurrentItem>(null);
  const [placed, setPlaced] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [highlightRank, setHighlightRank] = useState<number | null>(null);

  const slotRects = useRef<Record<number, SlotRect>>({});

  const navigateToWaiting = () => {
    router.replace({
      pathname: "/room/[code]/waiting",
      params: { code, name, isCreator: isCreator ?? "false" },
    });
  };

  const loadInitial = async () => {
    setLoading(true);
    setError(null);
    try {
      const voterId = await getVoterId();
      const room = await getRoom(code, voterId);
      if (room.mode !== "rank") {
        setError("This room isn't a blind rank room.");
        setLoading(false);
        return;
      }
      setTopic(room.topic);

      // Repaint locked slots from myRankings if resuming.
      // The server omits item titles for rank rooms post-start (server-enforced blind),
      // so we use a placeholder "•" — the real title isn't disclosed mid-game.
      if (room.myRankings && Object.keys(room.myRankings).length > 0) {
        const placedMap: Record<number, string> = {};
        for (const rank of Object.values(room.myRankings)) {
          placedMap[rank] = "•";
        }
        setPlaced(placedMap);
      }

      const next = await getNextRankItem(code, voterId);
      if (next.item) {
        setCurrent(next.item);
      } else {
        navigateToWaiting();
      }
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the room.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const handleSlotMeasure = (rank: number, rect: SlotRect) => {
    slotRects.current[rank] = rect;
  };

  const findSlotAt = (x: number, y: number): number | null => {
    for (let rank = 1; rank <= 5; rank++) {
      const r = slotRects.current[rank];
      if (!r) continue;
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
        return rank;
      }
    }
    return null;
  };

  const handleDragMove = (absX: number, absY: number) => {
    const hit = findSlotAt(absX, absY);
    if (hit && !placed[hit]) {
      setHighlightRank(hit);
    } else {
      setHighlightRank(null);
    }
  };

  const handleDragEnd = async (absX: number, absY: number) => {
    setHighlightRank(null);
    const hit = findSlotAt(absX, absY);
    if (!hit || placed[hit] || !current || submitting) return;

    setSubmitting(true);
    const placingTitle = current.title;
    const placingRank = hit;

    setPlaced((prev) => ({ ...prev, [placingRank]: placingTitle }));

    try {
      const voterId = await getVoterId();
      await submitRanking(code, {
        itemId: current.id,
        voterId,
        voterName: name,
        rank: placingRank,
      });

      const next = await getNextRankItem(code, voterId);
      if (next.item) {
        setCurrent(next.item);
      } else {
        navigateToWaiting();
      }
    } catch (e: any) {
      setPlaced((prev) => {
        const copy = { ...prev };
        delete copy[placingRank];
        return copy;
      });
      showAlert("Error", e instanceof ApiError ? e.message : "Couldn't submit your placement.");
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

  const placedCount = Object.keys(placed).length;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.topic} numberOfLines={1}>{topic}</Text>
        <Text style={styles.progress}>{placedCount + (current ? 1 : 0)} of 5</Text>
      </View>

      <View style={styles.cardArea}>
        {current && (
          <Animated.View key={current.id} entering={FadeIn.duration(200)} style={styles.cardWrap}>
            <RankCard
              title={current.title}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
            />
          </Animated.View>
        )}
      </View>

      <View style={styles.slots}>
        {[1, 2, 3, 4, 5].map((rank) => (
          <RankSlot
            key={rank}
            rank={rank}
            filledTitle={placed[rank] ?? null}
            highlighted={highlightRank === rank}
            onMeasure={handleSlotMeasure}
          />
        ))}
      </View>
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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  topic: {
    ...typography.h2,
    color: colors.charcoal,
    flex: 1,
    marginRight: spacing.md,
  },
  progress: {
    ...typography.bodyBold,
    color: colors.coral,
  },
  cardArea: {
    height: 180,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  cardWrap: {
    width: "85%",
  },
  slots: {
    gap: spacing.sm,
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
