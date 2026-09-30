import { useState } from "react";
import { View, Text, StyleSheet, Pressable, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import Animated, { FadeInDown } from "react-native-reanimated";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";

/** The room code, big, with copy and native share. */
export default function RoomCodeCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    try {
      await Share.share({ message: `Join my This or That room! Code: ${code}` });
    } catch {}
  };

  return (
    <Animated.View entering={FadeInDown.duration(500).delay(100).springify()} style={styles.card}>
      <Text style={styles.label}>ROOM CODE</Text>
      <Text style={styles.code} accessibilityLabel={`Room code ${code.split("").join(" ")}`}>
        {code}
      </Text>
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
          onPress={handleCopy}
          accessibilityRole="button"
          accessibilityLabel={copied ? "Copied" : "Copy room code"}
        >
          <Text style={styles.actionText}>{copied ? "Copied!" : "Copy"}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.actionButton, styles.shareButton, pressed && styles.shareButtonPressed]}
          onPress={handleShare}
          accessibilityRole="button"
          accessibilityLabel="Share room code"
        >
          <Text style={[styles.actionText, styles.shareText]}>Share</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.xl,
    padding: spacing.lg,
    alignItems: "center",
    marginBottom: spacing.md,
    ...shadows.card,
  },
  label: {
    ...typography.tiny,
    color: colors.mist,
    marginBottom: spacing.xs,
  },
  code: {
    fontSize: 36,
    fontWeight: "800",
    color: colors.coral,
    letterSpacing: 6,
    marginBottom: spacing.md,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionButton: {
    backgroundColor: colors.coralLight,
    paddingHorizontal: 20,
    paddingVertical: 8,
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
});
