import { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Alert, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRouter, useLocalSearchParams } from "expo-router";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { getVoterId } from "../../lib/storage";
import { startVoting, getParticipants, type Participant } from "../../lib/api";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";

export default function ShareScreen() {
  const router = useRouter();
  const { code, name } = useLocalSearchParams<{ code: string; name: string }>();
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    const poll = async () => {
      try {
        const data = await getParticipants(code);
        setParticipants(data.participants);
      } catch {}
    };

    poll();
    intervalRef.current = setInterval(poll, 3000);
    return () => clearInterval(intervalRef.current);
  }, [code]);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Join my This or That room! Code: ${code}`,
      });
    } catch {}
  };

  const handleStart = async () => {
    setLoading(true);
    try {
      const voterId = await getVoterId();
      await startVoting(code, voterId);
      router.replace({
        pathname: `/room/${code}/swipe`,
        params: { name, isCreator: "true" },
      });
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Animated.Text entering={FadeInUp.duration(400)} style={styles.heading}>
        Share this code
      </Animated.Text>
      <Animated.Text entering={FadeInUp.duration(400).delay(100)} style={styles.subheading}>
        Send it to your friends so they can join
      </Animated.Text>

      <Animated.View entering={FadeInDown.duration(500).delay(200).springify()} style={styles.codeCard}>
        <Text style={styles.codeLabel}>ROOM CODE</Text>
        <Text style={styles.code}>{code}</Text>
        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
            onPress={handleCopy}
          >
            <Text style={styles.actionText}>
              {copied ? "Copied!" : "Copy"}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionButton, styles.shareButton, pressed && styles.shareButtonPressed]}
            onPress={handleShare}
          >
            <Text style={[styles.actionText, styles.shareText]}>Share</Text>
          </Pressable>
        </View>
      </Animated.View>

      {participants.length > 0 && (
        <Animated.View entering={FadeInDown.duration(400).delay(300)} style={styles.participantSection}>
          <Text style={styles.participantHeading}>
            In the room ({participants.length})
          </Text>
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
                  <Text style={styles.hostBadgeText}>You</Text>
                </View>
              )}
            </View>
          ))}
        </Animated.View>
      )}

      <View style={styles.bottomSection}>
        <Pressable
          style={({ pressed }) => [
            styles.startButton,
            loading && styles.buttonDisabled,
            pressed && !loading && styles.startButtonPressed,
          ]}
          onPress={handleStart}
          disabled={loading}
        >
          <Text style={styles.startButtonText}>
            {loading ? "Starting..." : "Start Voting"}
          </Text>
        </Pressable>

        <Text style={styles.hint}>
          Start when everyone has joined
        </Text>
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
  heading: {
    ...typography.h1,
    color: colors.charcoal,
    textAlign: "center",
  },
  subheading: {
    ...typography.body,
    color: colors.slate,
    marginTop: spacing.sm,
    marginBottom: spacing.xxl,
    textAlign: "center",
  },
  codeCard: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: "center",
    marginBottom: spacing.xl,
    ...shadows.card,
  },
  codeLabel: {
    ...typography.tiny,
    color: colors.mist,
    marginBottom: spacing.sm,
  },
  code: {
    fontSize: 44,
    fontWeight: "800",
    color: colors.coral,
    letterSpacing: 8,
    marginBottom: spacing.lg,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionButton: {
    backgroundColor: colors.coralLight,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radius.pill,
  },
  actionButtonPressed: {
    backgroundColor: colors.noBg,
    transform: [{ scale: 0.95 }],
  },
  actionText: {
    ...typography.bodyBold,
    color: colors.coral,
  },
  shareButton: {
    backgroundColor: colors.tealLight,
  },
  shareButtonPressed: {
    backgroundColor: colors.yesBg,
    transform: [{ scale: 0.95 }],
  },
  shareText: {
    color: colors.teal,
  },
  participantSection: {
    flex: 1,
    marginBottom: spacing.lg,
  },
  participantHeading: {
    ...typography.tiny,
    color: colors.mist,
    marginBottom: spacing.md,
  },
  participantRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.warmWhite,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.coralLight,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.coral,
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
    marginTop: "auto",
  },
  startButton: {
    backgroundColor: colors.coral,
    paddingVertical: 18,
    borderRadius: radius.lg,
    alignItems: "center",
    ...shadows.button,
  },
  buttonDisabled: {
    opacity: 0.6,
    shadowOpacity: 0,
  },
  startButtonPressed: {
    backgroundColor: colors.coralDark,
    transform: [{ scale: 0.98 }],
  },
  startButtonText: {
    color: colors.warmWhite,
    fontSize: 18,
    fontWeight: "700",
  },
  hint: {
    ...typography.caption,
    color: colors.mist,
    marginTop: spacing.md,
    textAlign: "center",
  },
});
