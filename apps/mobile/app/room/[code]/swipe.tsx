import { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, Alert, ActivityIndicator, Pressable } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import SwipeCard from "../../../components/SwipeCard";
import { getVoterId } from "../../../lib/storage";
import { getRoom, submitVote } from "../../../lib/api";
import { seededShuffle } from "../../../lib/shuffle";

type Item = { id: string; title: string };

export default function SwipeScreen() {
  const router = useRouter();
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

      // Resume: skip items already voted on
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
        // Small delay to let swipe animation finish
        setTimeout(() => {
          if (nextIndex >= items.length) {
            router.replace({
              pathname: `/room/${code}/waiting`,
              params: { name, isCreator: isCreator ?? "false" },
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
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6C47FF" />
        <Text style={styles.loadingText}>Loading items...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={loadRoom}>
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  if (currentIndex >= items.length) {
    return (
      <View style={styles.centered}>
        <Text style={styles.doneText}>All done!</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.progress}>
        {currentIndex + 1} of {items.length}
      </Text>

      <View style={styles.cardContainer}>
        <SwipeCard
          key={items[currentIndex].id}
          title={items[currentIndex].title}
          onSwipe={handleSwipe}
        />
      </View>

      <View style={styles.hints}>
        <Text style={styles.hintNo}>Nah</Text>
        <Text style={styles.hintYes}>Yes!</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 24,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  progress: {
    textAlign: "center",
    fontSize: 16,
    color: "#999",
    marginBottom: 16,
  },
  cardContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  hints: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  hintNo: {
    fontSize: 18,
    color: "#e53e3e",
    fontWeight: "600",
  },
  hintYes: {
    fontSize: 18,
    color: "#48bb78",
    fontWeight: "600",
  },
  doneText: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#6C47FF",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#999",
  },
  errorText: {
    fontSize: 16,
    color: "#e53e3e",
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: "#6C47FF",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  retryText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
