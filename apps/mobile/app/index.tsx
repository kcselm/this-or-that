import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { colors, spacing, radius, typography, shadows } from "../lib/theme";

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top + 40 }]}>
      {/* Decorative dots */}
      <View style={styles.decorDots}>
        <View style={[styles.dot, styles.dotCoral]} />
        <View style={[styles.dot, styles.dotTeal]} />
        <View style={[styles.dot, styles.dotAmber]} />
      </View>

      <Animated.View entering={FadeInUp.duration(600).springify()} style={styles.header}>
        <Text style={styles.titleLine1}>This</Text>
        <Text style={styles.titleOr}>or</Text>
        <Text style={styles.titleLine2}>That</Text>
      </Animated.View>

      <Animated.Text
        entering={FadeInUp.duration(600).delay(150).springify()}
        style={styles.subtitle}
      >
        Swipe to decide, together.
      </Animated.Text>

      <Animated.View
        entering={FadeInDown.duration(500).delay(300).springify()}
        style={styles.buttons}
      >
        <Pressable
          style={({ pressed }) => [
            styles.button,
            styles.createButton,
            pressed && styles.createButtonPressed,
          ]}
          onPress={() => router.push("/create")}
        >
          <Text style={styles.createButtonText}>Create a Room</Text>
          <Text style={styles.createButtonArrow}>+</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.button,
            styles.joinButton,
            pressed && styles.joinButtonPressed,
          ]}
          onPress={() => router.push("/join")}
        >
          <Text style={styles.joinButtonText}>Join a Room</Text>
          <Text style={styles.joinButtonArrow}>→</Text>
        </Pressable>
      </Animated.View>

      <Animated.Text
        entering={FadeInDown.duration(400).delay(500)}
        style={styles.tagline}
      >
        No accounts. No fuss. Just swipe.
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
    backgroundColor: colors.cream,
  },
  decorDots: {
    position: "absolute",
    top: 80,
    right: 30,
    flexDirection: "row",
    gap: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotCoral: { backgroundColor: colors.coral },
  dotTeal: { backgroundColor: colors.teal },
  dotAmber: { backgroundColor: colors.amber },
  header: {
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  titleLine1: {
    fontSize: 56,
    fontWeight: "900",
    color: colors.charcoal,
    letterSpacing: -2,
    lineHeight: 60,
  },
  titleOr: {
    fontSize: 24,
    fontWeight: "400",
    fontStyle: "italic",
    color: colors.coral,
    marginVertical: -2,
  },
  titleLine2: {
    fontSize: 56,
    fontWeight: "900",
    color: colors.coral,
    letterSpacing: -2,
    lineHeight: 60,
  },
  subtitle: {
    ...typography.body,
    color: colors.slate,
    marginBottom: spacing.xxxl + 16,
    textAlign: "center",
  },
  buttons: {
    width: "100%",
    gap: spacing.md,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
  },
  createButton: {
    backgroundColor: colors.coral,
    ...shadows.button,
  },
  createButtonPressed: {
    backgroundColor: colors.coralDark,
    transform: [{ scale: 0.98 }],
  },
  createButtonText: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.warmWhite,
    flex: 1,
    textAlign: "center",
  },
  createButtonArrow: {
    fontSize: 22,
    fontWeight: "700",
    color: "rgba(255,255,255,0.7)",
    position: "absolute",
    right: 20,
  },
  joinButton: {
    backgroundColor: colors.warmWhite,
    borderWidth: 2,
    borderColor: colors.sand,
  },
  joinButtonPressed: {
    backgroundColor: colors.sandLight,
    transform: [{ scale: 0.98 }],
  },
  joinButtonText: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.charcoal,
    flex: 1,
    textAlign: "center",
  },
  joinButtonArrow: {
    fontSize: 20,
    fontWeight: "600",
    color: colors.mist,
    position: "absolute",
    right: 20,
  },
  tagline: {
    ...typography.caption,
    color: colors.mist,
    marginTop: spacing.xxxl,
    textAlign: "center",
  },
});
