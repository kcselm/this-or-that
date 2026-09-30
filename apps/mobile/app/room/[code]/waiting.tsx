import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import Animated, {
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { getStatus, revealResults, getRoom, ApiError, type StatusResponse } from "../../../lib/api";
import { getVoterId } from "../../../lib/storage";
import { usePolling } from "../../../lib/usePolling";
import { showAlert } from "../../../lib/alert";
import { IN_PROGRESS_LABELS, type Mode } from "../../../lib/modes";
import { colors, spacing, radius, typography, shadows } from "../../../lib/theme";

function PulsingRing() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.6);

  scale.value = withRepeat(withTiming(1.3, { duration: 1200 }), -1, true);
  opacity.value = withRepeat(withTiming(0, { duration: 1200 }), -1, true);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return <Animated.View style={[ringStyles.ring, style]} />;
}

const ringStyles = StyleSheet.create({
  ring: {
    position: "absolute",
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: colors.coral,
  },
});

export default function WaitingScreen() {
  const router = useRouter();
  const {
    code,
    name,
    isCreator: isCreatorParam,
    lastVotedRound,
  } = useLocalSearchParams<{
    code: string;
    name: string;
    isCreator?: string;
    lastVotedRound?: string;
  }>();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const isCreator = isCreatorParam === "true";

  usePolling(async (stop) => {
    try {
      // The bracket round-reveal hop below needs the room's mode. Resolve it
      // inside the poll so a failed lookup retries next tick — a single
      // silent failure here used to strand bracket players on this screen
      // for the rest of the game.
      let currentMode = mode;
      if (currentMode === null) {
        currentMode = (await getRoom(code)).mode;
        setMode(currentMode);
      }

      const data = await getStatus(code);
      setStatus(data);
      if (data.isRevealed) {
        stop();
        router.replace({
          pathname: "/room/[code]/results",
          params: { code, name },
        });
        return;
      }
      // Bracket: when the server advances the round past lastVotedRound,
      // hop the player to the round-reveal screen.
      if (
        currentMode === "bracket" &&
        lastVotedRound &&
        typeof data.currentRound === "number" &&
        data.currentRound > Number(lastVotedRound)
      ) {
        stop();
        router.replace({
          pathname: "/room/[code]/round-reveal",
          params: {
            code,
            name,
            isCreator: isCreatorParam ?? "false",
            completedRound: lastVotedRound,
          },
        });
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "ROOM_NOT_FOUND") {
        stop();
        showAlert("Room Expired", "This room no longer exists.", () => router.replace("/"));
      }
    }
  }, 3000);

  const completedCount = status?.completedCount ?? 0;
  const totalVoters = status?.totalVoters ?? 0;
  const progressPercent = totalVoters > 0 ? (completedCount / totalVoters) * 100 : 0;

  return (
    <View style={styles.container}>
      <View style={styles.topSection}>
        <View style={styles.pulseContainer}>
          <PulsingRing />
          <View style={styles.countCircle}>
            <Text style={styles.countNumber}>{completedCount}</Text>
            <Text style={styles.countOf}>of {totalVoters}</Text>
          </View>
        </View>

        <Animated.Text entering={FadeInUp.duration(400)} style={styles.heading}>
          Waiting for others
        </Animated.Text>

        {status?.roundNumber && status.roundNumber > 1 ? (
          <Text style={styles.roundCaption}>Round {status.roundNumber}</Text>
        ) : null}

        {status && (
          <View style={styles.progressBar}>
            <Animated.View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
          </View>
        )}
      </View>

      {status && status.voters.length > 0 && (
        <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.voterList}>
          {status.voters.map((voter, i) => (
            <View key={i} style={styles.voterChip}>
              <View style={[styles.avatar, voter.completed && styles.avatarDone]}>
                <Text style={[styles.avatarText, voter.completed && styles.avatarTextDone]}>
                  {voter.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={styles.voterName} numberOfLines={1}>
                {voter.name}
              </Text>
              <View
                style={[
                  styles.statusBadge,
                  voter.completed ? styles.doneBadge : styles.pendingBadge,
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    voter.completed ? styles.doneText : styles.pendingText,
                  ]}
                >
                  {voter.completed ? "Done" : IN_PROGRESS_LABELS[mode ?? "vote"]}
                </Text>
              </View>
            </View>
          ))}
        </Animated.View>
      )}

      <View style={styles.bottomSection}>
        {isCreator && status && status.completedCount > 0 && (
          <Pressable
            style={({ pressed }) => [
              styles.revealButton,
              revealing && styles.buttonDisabled,
              pressed && !revealing && styles.revealButtonPressed,
            ]}
            onPress={async () => {
              setRevealing(true);
              try {
                const voterId = await getVoterId();
                await revealResults(code, voterId);
                router.replace({
                  pathname: "/room/[code]/results",
                  params: { code, name },
                });
              } catch (e: any) {
                showAlert("Error", e.message);
                setRevealing(false);
              }
            }}
            disabled={revealing}
          >
            <Text style={styles.revealButtonText}>
              {revealing ? "Revealing..." : "Reveal Results"}
            </Text>
          </Pressable>
        )}
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
  pulseContainer: {
    width: 80,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xl,
  },
  countCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.coralLight,
    alignItems: "center",
    justifyContent: "center",
  },
  countNumber: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.coral,
    lineHeight: 28,
  },
  countOf: {
    ...typography.tiny,
    color: colors.coral,
    fontSize: 10,
  },
  heading: {
    ...typography.h2,
    color: colors.charcoal,
    marginBottom: spacing.lg,
  },
  roundCaption: {
    ...typography.caption,
    color: colors.mist,
    marginTop: -spacing.md,
    marginBottom: spacing.lg,
  },
  progressBar: {
    width: "100%",
    height: 6,
    backgroundColor: colors.sand,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: spacing.xxl,
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.coral,
    borderRadius: 3,
  },
  voterList: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    alignContent: "flex-start",
  },
  voterChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.warmWhite,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    gap: spacing.xs,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.sandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarDone: {
    backgroundColor: colors.tealLight,
  },
  avatarText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.slate,
  },
  avatarTextDone: {
    color: colors.teal,
  },
  voterName: {
    ...typography.caption,
    color: colors.charcoal,
    maxWidth: 80,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  doneBadge: {
    backgroundColor: colors.tealLight,
  },
  pendingBadge: {
    backgroundColor: colors.sandLight,
  },
  statusText: {
    ...typography.tiny,
    fontSize: 9,
  },
  doneText: {
    color: colors.teal,
  },
  pendingText: {
    color: colors.mist,
  },
  bottomSection: {
    marginTop: "auto",
    gap: spacing.md,
    alignItems: "center",
  },
  revealButton: {
    width: "100%",
    backgroundColor: colors.coral,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    ...shadows.button,
  },
  buttonDisabled: {
    opacity: 0.6,
    shadowOpacity: 0,
  },
  revealButtonPressed: {
    backgroundColor: colors.coralDark,
    transform: [{ scale: 0.98 }],
  },
  revealButtonText: {
    color: colors.warmWhite,
    fontSize: 18,
    fontWeight: "700",
  },
  leaveButton: {
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
