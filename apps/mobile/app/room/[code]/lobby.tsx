import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import Animated, { FadeInDown, FadeInUp, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { getRoom, getParticipants, ApiError, type Participant } from "../../../lib/api";
import { getVoterId } from "../../../lib/storage";
import { colors, spacing, radius, typography, shadows } from "../../../lib/theme";

function PulsingDot() {
  const opacity = useSharedValue(1);

  opacity.value = withRepeat(withTiming(0.3, { duration: 1000 }), -1, true);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return <Animated.View style={[dotStyles.dot, style]} />;
}

const dotStyles = StyleSheet.create({
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.coral,
  },
});

export default function LobbyScreen() {
  const router = useRouter();
  const { code, name } = useLocalSearchParams<{ code: string; name: string }>();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [topic, setTopic] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    const poll = async () => {
      try {
        const voterId = await getVoterId();
        const room = await getRoom(code, voterId);
        if (room.topic) setTopic(room.topic);
        if (room.status === "voting") {
          clearInterval(intervalRef.current);
          router.replace({
            pathname: `/room/${code}/swipe`,
            params: { name },
          });
          return;
        } else if (room.status === "revealed") {
          clearInterval(intervalRef.current);
          router.replace({
            pathname: `/room/${code}/results`,
            params: { name },
          });
          return;
        }

        const data = await getParticipants(code);
        setParticipants(data.participants);
      } catch (e) {
        if (e instanceof ApiError && e.code === "ROOM_NOT_FOUND") {
          clearInterval(intervalRef.current);
          Alert.alert("Room Expired", "This room no longer exists.", [
            { text: "OK", onPress: () => router.replace("/") },
          ]);
        }
      }
    };

    poll();
    intervalRef.current = setInterval(poll, 3000);
    return () => clearInterval(intervalRef.current);
  }, [code, name, router]);

  return (
    <View style={styles.container}>
      <View style={styles.topSection}>
        <Animated.View entering={FadeInUp.duration(400)} style={styles.statusRow}>
          <PulsingDot />
          <Text style={styles.statusText}>Waiting for host</Text>
        </Animated.View>
        {topic && (
          <Animated.Text entering={FadeInUp.duration(400).delay(100)} style={styles.topicText}>
            {topic}
          </Animated.Text>
        )}
        <Animated.Text entering={FadeInUp.duration(400).delay(150)} style={styles.subheading}>
          The host is still setting up. Voting will start soon...
        </Animated.Text>
      </View>

      {participants.length > 0 && (
        <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.participantSection}>
          <Text style={styles.participantHeading}>
            IN THE ROOM ({participants.length})
          </Text>
          <View style={styles.participantList}>
            {participants.map((p) => (
              <View key={p.voterId} style={styles.participantRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {p.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.participantName}>{p.name}</Text>
                {p.isCreator && (
                  <View style={styles.hostBadge}>
                    <Text style={styles.hostBadgeText}>HOST</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </Animated.View>
      )}

      <View style={styles.bottomSection}>
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>ROOM CODE</Text>
          <Text style={styles.code}>{code}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.leaveButton, pressed && styles.leaveButtonPressed]}
          onPress={() => router.replace("/")}
        >
          <Text style={styles.leaveText}>Leave Room</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xl,
    backgroundColor: colors.cream,
  },
  topSection: {
    alignItems: "center",
    marginTop: spacing.xxxl,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  statusText: {
    ...typography.h2,
    color: colors.charcoal,
  },
  topicText: {
    ...typography.h1,
    color: colors.coral,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  subheading: {
    ...typography.body,
    color: colors.slate,
    textAlign: "center",
    marginBottom: spacing.xxl,
  },
  participantSection: {
    flex: 1,
  },
  participantHeading: {
    ...typography.tiny,
    color: colors.mist,
    marginBottom: spacing.md,
  },
  participantList: {
    gap: spacing.sm,
  },
  participantRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.warmWhite,
    padding: spacing.md,
    borderRadius: radius.md,
    gap: spacing.md,
    ...shadows.soft,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.tealLight,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.teal,
  },
  participantName: {
    ...typography.bodyBold,
    color: colors.charcoal,
    flex: 1,
  },
  hostBadge: {
    backgroundColor: colors.amberLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  hostBadgeText: {
    ...typography.tiny,
    color: colors.amber,
    fontSize: 10,
  },
  bottomSection: {
    alignItems: "center",
    marginTop: "auto",
  },
  codeCard: {
    backgroundColor: colors.warmWhite,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    alignItems: "center",
    ...shadows.soft,
  },
  codeLabel: {
    ...typography.tiny,
    color: colors.mist,
    marginBottom: spacing.xs,
  },
  code: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.coral,
    letterSpacing: 4,
  },
  leaveButton: {
    marginTop: spacing.xl,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  leaveButtonPressed: {
    opacity: 0.6,
  },
  leaveText: {
    ...typography.body,
    color: colors.mist,
  },
});
