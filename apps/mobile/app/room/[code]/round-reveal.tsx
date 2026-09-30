import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInUp } from "react-native-reanimated";
import BracketView from "../../../components/BracketView";
import { getBracket, ApiError, type BracketRound } from "../../../lib/api";
import { getVoterId } from "../../../lib/storage";
import { colors, spacing, radius, typography, shadows } from "../../../lib/theme";

export default function RoundRevealScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code, name, isCreator, completedRound } = useLocalSearchParams<{
    code: string;
    name: string;
    isCreator?: string;
    completedRound: string;
  }>();

  const completed = Number(completedRound);

  const [rounds, setRounds] = useState<BracketRound[]>([]);
  const [currentRound, setCurrentRound] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const voterId = await getVoterId();
      const data = await getBracket(code, voterId);
      // Include rounds 1..completed (decided rounds with vote breakdowns).
      // Also include the just-opened next round as a preview ("coming up").
      // The BracketTree shows whatever rounds we pass it.
      setRounds(data.rounds.filter((r) => r.round <= completed + 1));
      setCurrentRound(data.currentRound);
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the bracket.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const handleContinue = () => {
    if (currentRound === null) {
      // Room was revealed by the time we loaded.
      router.replace({ pathname: "/room/[code]/results", params: { code, name } });
      return;
    }
    router.replace({
      pathname: "/room/[code]/bracket",
      params: { code, name, isCreator: isCreator ?? "false" },
    });
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
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Animated.Text entering={FadeInUp.duration(400)} style={styles.heading}>
        Round {completed} complete
      </Animated.Text>
      {currentRound !== null && currentRound > completed && (
        <Text style={styles.subheading}>Round {currentRound} is up next</Text>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <BracketView rounds={rounds} highlightRound={completed} expandableBreakdowns={false} />
      </ScrollView>

      <Pressable
        style={({ pressed }) => [styles.continueButton, pressed && styles.continueButtonPressed]}
        onPress={handleContinue}
      >
        <Text style={styles.continueText}>
          {currentRound === null ? "See Final Results" : "Continue"}
        </Text>
      </Pressable>
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
  heading: {
    ...typography.h1,
    color: colors.coral,
    textAlign: "center",
  },
  subheading: {
    ...typography.body,
    color: colors.slate,
    textAlign: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.lg,
  },
  continueButton: {
    backgroundColor: colors.coral,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    marginTop: spacing.md,
    ...shadows.button,
  },
  continueButtonPressed: {
    backgroundColor: colors.coralDark,
    transform: [{ scale: 0.98 }],
  },
  continueText: {
    color: colors.warmWhite,
    fontSize: 18,
    fontWeight: "700",
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
