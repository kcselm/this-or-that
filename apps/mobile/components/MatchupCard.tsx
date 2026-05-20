import { Pressable, Text, StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { colors, spacing, radius, typography, shadows } from "../lib/theme";

type Props = {
  title: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export default function MatchupCard({ title, selected, disabled, onPress }: Props) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    if (disabled) return;
    scale.value = withTiming(0.96, { duration: 80 }, () => {
      scale.value = withTiming(1, { duration: 120 });
    });
    onPress();
  };

  return (
    <Animated.View style={[styles.wrap, animStyle]}>
      <Pressable
        onPress={handlePress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.card,
          selected && styles.cardSelected,
          pressed && !disabled && styles.cardPressed,
        ]}
      >
        <Text style={styles.title} numberOfLines={4} adjustsFontSizeToFit minimumFontScale={0.7}>
          {title}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  card: {
    flex: 1,
    backgroundColor: colors.warmWhite,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.sand,
    padding: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.card,
  },
  cardSelected: {
    borderColor: colors.coral,
    backgroundColor: colors.coralLight,
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: colors.sandLight,
  },
  title: {
    ...typography.h2,
    color: colors.charcoal,
    textAlign: "center",
  },
});
