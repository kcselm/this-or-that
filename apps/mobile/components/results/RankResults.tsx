import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import type { RankResults as RankResultsData } from "../../lib/api";
import type { NextRound } from "../../lib/useNextRound";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";
import RankPlayerCard from "../RankPlayerCard";
import { resultStyles, type ResultsViewProps } from "./styles";

type Props = ResultsViewProps<RankResultsData> & {
  /** Keep-playing controls; absent when viewing a saved snapshot. */
  nextRound?: NextRound;
};

export default function RankResults({ data, homeLabel, onHome, nextRound }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={resultStyles.container}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: spacing.xxl }}
    >
      <Animated.Text entering={FadeInUp.duration(400)} style={styles.topic}>
        {data.topic}
      </Animated.Text>
      <Text style={styles.meta}>{data.players.length} players ranked</Text>
      <View style={styles.list}>
        {data.players.map((p, i) => (
          <Animated.View key={p.participantId} entering={FadeInDown.duration(400).delay(i * 80)}>
            <RankPlayerCard
              name={p.name}
              isYou={p.isYou}
              isCreator={p.isCreator}
              rankings={p.rankings}
            />
          </Animated.View>
        ))}
      </View>

      {nextRound && <KeepPlaying nextRound={nextRound} />}

      <Pressable
        style={({ pressed }) => [resultStyles.homeLink, pressed && { opacity: 0.6 }]}
        onPress={onHome}
      >
        <Text style={resultStyles.homeLinkText}>{homeLabel}</Text>
      </Pressable>
    </ScrollView>
  );
}

function KeepPlaying({ nextRound }: { nextRound: NextRound }) {
  const { nextHost, advancing, isHost, iAmNext, participants } = nextRound;
  const [showPicker, setShowPicker] = useState(false);

  const handlePick = async (participantId?: string) => {
    if (await nextRound.pick(participantId)) setShowPicker(false);
  };

  if (advancing) {
    return (
      <View style={styles.banner}>
        <Text style={styles.bannerText}>Heading to the next round…</Text>
      </View>
    );
  }

  return (
    <>
      {nextHost && !iAmNext && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            🎲 {nextHost.name} is up next — waiting for their category…
          </Text>
        </View>
      )}
      {iAmNext && (
        <Pressable
          style={({ pressed }) => [styles.youreUpButton, pressed && { opacity: 0.85 }]}
          onPress={nextRound.createNextRound}
        >
          <Text style={styles.buttonText}>You're up! Create the next category</Text>
        </Pressable>
      )}
      {isHost && (
        <Pressable
          style={({ pressed }) => [
            styles.keepPlayingButton,
            pressed && resultStyles.homeButtonPressed,
          ]}
          onPress={() => setShowPicker(true)}
        >
          <Text style={styles.buttonText}>{nextHost ? "Change next host" : "Keep Playing"}</Text>
        </Pressable>
      )}

      <Modal
        visible={showPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPicker(false)}
      >
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Who hosts the next round?</Text>
            <Pressable
              style={styles.pickerRandom}
              onPress={() => handlePick()}
              accessibilityRole="button"
            >
              <Text style={styles.pickerRandomText}>🎲 Pick randomly</Text>
            </Pressable>
            {participants.map((p) => (
              <Pressable
                key={p.participantId}
                style={styles.pickerRow}
                onPress={() => handlePick(p.participantId)}
                accessibilityRole="button"
              >
                <Text style={styles.pickerRowText}>{p.isYou ? `${p.name} (you)` : p.name}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setShowPicker(false)} accessibilityRole="button">
              <Text style={styles.pickerCancel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  topic: {
    ...typography.h1,
    color: colors.coral,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
  meta: {
    ...typography.caption,
    color: colors.mist,
    textAlign: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  list: {
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  keepPlayingButton: {
    backgroundColor: colors.coral,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    marginTop: spacing.lg,
    marginHorizontal: spacing.xl,
    ...shadows.button,
  },
  youreUpButton: {
    backgroundColor: colors.teal,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    marginTop: spacing.lg,
    marginHorizontal: spacing.xl,
    ...shadows.button,
  },
  buttonText: {
    color: colors.warmWhite,
    fontSize: 18,
    fontWeight: "700",
  },
  banner: {
    backgroundColor: colors.warmWhite,
    borderWidth: 2,
    borderColor: colors.amber,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
    marginHorizontal: spacing.xl,
  },
  bannerText: {
    ...typography.body,
    color: colors.charcoal,
    textAlign: "center",
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: spacing.xl,
  },
  pickerCard: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  pickerTitle: {
    ...typography.h3,
    color: colors.charcoal,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  pickerRandom: {
    backgroundColor: colors.coral,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  pickerRandomText: {
    ...typography.bodyBold,
    color: colors.warmWhite,
  },
  pickerRow: {
    backgroundColor: colors.sandLight,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  pickerRowText: {
    ...typography.bodyBold,
    color: colors.charcoal,
  },
  pickerCancel: {
    ...typography.body,
    color: colors.mist,
    textAlign: "center",
    paddingVertical: spacing.sm,
  },
});
