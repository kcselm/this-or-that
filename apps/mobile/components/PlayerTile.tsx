import { Pressable, Text, StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import type { PlayerColor } from "../lib/player-colors";
import { radius, spacing, typography, shadows } from "../lib/theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
  name: string;
  color: PlayerColor;
  selected?: boolean;
  onPress: () => void;
  disabled?: boolean;
};

export default function PlayerTile({ name, color, selected, onPress, disabled }: Props) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      onPressIn={() => {
        scale.value = withSpring(0.95, { damping: 15 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 15 });
      }}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.tile,
        {
          backgroundColor: selected ? color.base : color.tint,
          borderColor: color.border,
        },
        animatedStyle,
      ]}
    >
      <Text
        style={[styles.name, { color: selected ? color.textOnBase : "#333" }]}
        numberOfLines={1}
      >
        {name}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: 100,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.soft,
  },
  name: {
    ...typography.h3,
    textAlign: "center",
  },
});
