import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  SlideInRight,
  SlideOutLeft,
} from "react-native-reanimated";
import PlayerTile from "../../../components/PlayerTile";
import {
  getRoom,
  getParticipants,
  submitMltVote,
  ApiError,
  type RoomResponse,
  type Participant,
} from "../../../lib/api";
import { getVoterId } from "../../../lib/storage";
import { getPlayerColor } from "../../../lib/player-colors";
import { colors, spacing, radius, typography } from "../../../lib/theme";

export default function MltPlayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code, name, isCreator } = useLocalSearchParams<{
    code: string;
    name?: string;
    isCreator?: string;
  }>();

  const [room, setRoom] = useState<RoomResponse | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [myVoterId, setMyVoterId] = useState<string>("");
  const [myMltVotes, setMyMltVotes] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const voterId = await getVoterId();
        setMyVoterId(voterId);
        const [roomRes, partRes] = await Promise.all([
          getRoom(code, voterId),
          getParticipants(code),
        ]);
        setRoom(roomRes);
        setParticipants(partRes.participants);
        const my = roomRes.myMltVotes ?? {};
        setMyMltVotes(my);
        // Resume: skip past already-voted prompts
        const items = roomRes.items;
        const firstUnvoted = items.findIndex((it) => !my[it.id]);
        setCurrentIndex(firstUnvoted === -1 ? items.length : firstUnvoted);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Couldn't load the room.");
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  // If the room is already revealed by the time we open the screen, route to results
  useEffect(() => {
    if (room?.status === "revealed") {
      router.replace({ pathname: "/room/[code]/results", params: { code, name: name ?? "" } });
    }
  }, [room?.status, code, name, router]);

  // If we've voted on every prompt, route to waiting
  useEffect(() => {
    if (!room) return;
    if (currentIndex >= room.items.length) {
      router.replace({
        pathname: "/room/[code]/waiting",
        params: { code, name: name ?? "", isCreator: isCreator ?? "false" },
      });
    }
  }, [currentIndex, room, code, name, isCreator, router]);

  const colorByVoterId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getPlayerColor>>();
    participants.forEach((p, i) => map.set(p.voterId, getPlayerColor(i)));
    return map;
  }, [participants]);

  // Suppress unused-warning while keeping local cache for future use (e.g. re-vote UI)
  void myMltVotes;

  const handleVote = async (targetVoterId: string) => {
    if (!room || submitting) return;
    const item = room.items[currentIndex];
    if (!item) return;
    setSubmitting(true);
    try {
      await submitMltVote(code, {
        itemId: item.id,
        voterId: myVoterId,
        voterName: name ?? "",
        targetVoterId,
      });
      setMyMltVotes((prev) => ({ ...prev, [item.id]: targetVoterId }));
      setCurrentIndex((prev) => prev + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't submit vote.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator />
      </View>
    );
  }
  if (error) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }
  if (!room || currentIndex >= room.items.length) {
    // Routing handled in effects above
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator />
      </View>
    );
  }

  const currentItem = room.items[currentIndex];

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.lg }]}>
      <View style={styles.header}>
        <Text style={styles.progress}>
          Prompt {currentIndex + 1} of {room.items.length}
        </Text>
      </View>

      <Animated.View
        key={currentItem.id}
        entering={SlideInRight.duration(220)}
        exiting={SlideOutLeft.duration(180)}
        style={styles.promptCard}
      >
        <Text style={styles.promptText}>{currentItem.title}</Text>
      </Animated.View>

      <View style={styles.tileGrid}>
        {participants.map((p) => {
          const color = colorByVoterId.get(p.voterId) ?? getPlayerColor(0);
          const label = p.voterId === myVoterId ? `${p.name} (you)` : p.name;
          return (
            <View key={p.voterId} style={styles.tileWrapper}>
              <PlayerTile
                name={label}
                color={color}
                onPress={() => handleVote(p.voterId)}
                disabled={submitting}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.cream, padding: spacing.xl },
  center: { alignItems: "center", justifyContent: "center" },
  header: { marginBottom: spacing.lg, alignItems: "center" },
  progress: { ...typography.body, color: colors.slate },
  promptCard: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.lg,
    padding: spacing.xl,
    minHeight: 180,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.xl,
    borderWidth: 2,
    borderColor: colors.sand,
  },
  promptText: {
    ...typography.h2,
    color: colors.charcoal,
    textAlign: "center",
  },
  tileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "center",
  },
  tileWrapper: {
    minWidth: "45%",
    flexBasis: "45%",
    flexGrow: 1,
  },
  errorText: { ...typography.body, color: colors.slate, textAlign: "center" },
});
