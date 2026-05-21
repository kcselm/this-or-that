import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";

export default function ModePickerScreen() {
  const router = useRouter();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.heading}>Pick a game mode</Text>

      <Animated.View entering={FadeInDown.duration(400).delay(100).springify()}>
        <Pressable
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => router.push({ pathname: "/create", params: { mode: "vote" } })}
        >
          <Text style={styles.cardEmoji}>♥</Text>
          <Text style={styles.cardTitle}>Swipe Vote</Text>
          <Text style={styles.cardDescription}>
            Add a list of options. Everyone swipes yes or no. See what wins.
          </Text>
        </Pressable>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(400).delay(200).springify()}>
        <Pressable
          style={({ pressed }) => [styles.card, styles.cardRank, pressed && styles.cardPressed]}
          onPress={() => router.push({ pathname: "/create", params: { mode: "rank" } })}
        >
          <Text style={styles.cardEmoji}>◎</Text>
          <Text style={styles.cardTitle}>Blind Rank</Text>
          <Text style={styles.cardDescription}>
            Pick 5 items. Players rank them one at a time without knowing what's coming next.
          </Text>
        </Pressable>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(400).delay(300).springify()}>
        <Pressable
          style={({ pressed }) => [styles.card, styles.cardBracket, pressed && styles.cardPressed]}
          onPress={() => router.push({ pathname: "/create", params: { mode: "bracket" } })}
        >
          <Text style={styles.cardEmoji}>⚔</Text>
          <Text style={styles.cardTitle}>Bracket</Text>
          <Text style={styles.cardDescription}>
            Items face off in a tournament. Each round, everyone votes on the matchups. See the bracket grow.
          </Text>
        </Pressable>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(400).delay(400).springify()}>
        <Pressable
          style={({ pressed }) => [styles.card, styles.cardMlt, pressed && styles.cardPressed]}
          onPress={() => router.push({ pathname: "/create", params: { mode: "mlt" } })}
        >
          <Text style={styles.cardEmoji}>★</Text>
          <Text style={styles.cardTitle}>Most Likely To</Text>
          <Text style={styles.cardDescription}>
            Pick prompts like "most likely to ghost the group chat." For each one, vote on
            the person in the room who fits it best.
          </Text>
        </Pressable>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  content: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  heading: {
    ...typography.h1,
    color: colors.charcoal,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 2,
    borderColor: colors.sand,
    ...shadows.soft,
  },
  cardRank: {
    borderColor: colors.tealLight,
  },
  cardBracket: {
    borderColor: colors.amberLight,
  },
  cardMlt: {
    borderColor: "#7C6EF2", // matches PLAYER_COLORS[3].border for thematic consistency
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: colors.sandLight,
  },
  cardEmoji: {
    fontSize: 28,
    marginBottom: spacing.sm,
    color: colors.coral,
  },
  cardTitle: {
    ...typography.h2,
    color: colors.charcoal,
    marginBottom: spacing.sm,
  },
  cardDescription: {
    ...typography.body,
    color: colors.slate,
    lineHeight: 22,
  },
});
