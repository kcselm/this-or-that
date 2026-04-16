import { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, Alert, ActivityIndicator, Pressable } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn } from "react-native-reanimated";
import SwipeCard from "../../../components/SwipeCard";
import { getVoterId } from "../../../lib/storage";
import { getRoom, submitVote } from "../../../lib/api";
import { seededShuffle } from "../../../lib/shuffle";
import { colors, spacing, radius, typography, shadows } from "../../../lib/theme";

type Item = { id: string; title: string };

export default function SwipeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code, name, isCreator } = useLocalSearchParams<{
    code: string;
    name: string;
    isCreator?: string;
  }>();
  const [items, setItems] = useState<Item[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [swiping, setSwiping] = useState(false);

  const loadRoom = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const voterId = await getVoterId();
      const room = await getRoom(code, voterId);
      const shuffled = seededShuffle(room.items, voterId);

      const votedIds = new Set(Object.keys(room.myVotes ?? {}));
      const startIndex = shuffled.findIndex((item) => !votedIds.has(item.id));

      setItems(shuffled);
      setCurrentIndex(startIndex === -1 ? shuffled.length : startIndex);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    loadRoom();
  }, [loadRoom]);

  const handleSwipe = useCallback(
    async (direction: "yes" | "no") => {
      if (swiping) return;
      setSwiping(true);
      const item = items[currentIndex];

      try {
        const voterId = await getVoterId();
        await submitVote(code, {
          itemId: item.id,
          voterId,
          voterName: name,
          vote: direction,
        });

        const nextIndex = currentIndex + 1;
        setTimeout(() => {
          if (nextIndex >= items.length) {
            router.replace({
              pathname: "/room/[code]/waiting",
              params: { code, name, isCreator: isCreator ?? "false" },
            });
          } else {
            setCurrentIndex(nextIndex);
            setSwiping(false);
          }
        }, 250);
      } catch (e: any) {
        Alert.alert("Error", e.message);
        setSwiping(false);
      }
    },
    [code, currentIndex, items, name, router, swiping]
  );

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.coral} />
        <Text style={styles.loadingText}>Loading items...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable
          style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
          onPress={loadRoom}
        >
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  if (currentIndex >= items.length) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.doneText}>All done!</Text>
      </View>
    );
  }

  const progress = ((currentIndex + 1) / items.length) * 100;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      {/* Progress bar */}
      <View style={styles.progressSection}>
        <View style={styles.progressBar}>
          <Animated.View
            style={[styles.progressFill, { width: `${progress}%` }]}
          />
        </View>
        <Text style={styles.progressText}>
          {currentIndex + 1} of {items.length}
        </Text>
      </View>

      <View style={styles.cardContainer}>
        <SwipeCard
          key={items[currentIndex].id}
          title={items[currentIndex].title}
          onSwipe={handleSwipe}
        />
      </View>

      <View style={styles.hints}>
        <View style={styles.hintBubble}>
          <Text style={styles.hintArrow}>←</Text>
          <Text style={styles.hintNo}>Nah</Text>
        </View>
        <View style={[styles.hintBubble, styles.hintBubbleYes]}>
          <Text style={styles.hintYes}>Yes!</Text>
          <Text style={styles.hintArrow}>→</Text>
        </View>
      </View>
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
  progressSection: {
    alignItems: "center",
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  progressBar: {
    width: "100%",
    height: 6,
    backgroundColor: colors.sand,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.coral,
    borderRadius: 3,
  },
  progressText: {
    ...typography.caption,
    color: colors.mist,
  },
  cardContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  hints: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.lg,
  },
  hintBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.coralLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  hintBubbleYes: {
    backgroundColor: colors.tealLight,
  },
  hintArrow: {
    fontSize: 14,
    color: colors.mist,
  },
  hintNo: {
    ...typography.bodyBold,
    color: colors.coral,
    fontSize: 14,
  },
  hintYes: {
    ...typography.bodyBold,
    color: colors.teal,
    fontSize: 14,
  },
  doneText: {
    ...typography.h1,
    color: colors.coral,
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
  },
  retryButtonPressed: {
    backgroundColor: colors.coralDark,
  },
  retryText: {
    color: colors.warmWhite,
    ...typography.bodyBold,
  },
});
