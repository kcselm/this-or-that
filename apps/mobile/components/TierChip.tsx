import { StyleSheet, Text } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { colors, radius, spacing, typography, shadows } from "../lib/theme";

type Props = {
  id: string;
  title: string;
  badgeColor: string;
  selected: boolean;
  onTap: (id: string) => void;
  onDragMove: (id: string, absX: number, absY: number) => void;
  onDragEnd: (id: string, absX: number, absY: number) => void;
};

export default function TierChip({
  id,
  title,
  badgeColor,
  selected,
  onTap,
  onDragMove,
  onDragEnd,
}: Props) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const active = useSharedValue(0);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      active.value = 1;
      translateX.value = e.translationX;
      translateY.value = e.translationY;
      runOnJS(onDragMove)(id, e.absoluteX, e.absoluteY);
    })
    .onEnd((e, success) => {
      if (success) runOnJS(onDragEnd)(id, e.absoluteX, e.absoluteY);
      translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
      translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
      active.value = 0;
    });

  const tap = Gesture.Tap().onEnd((_e, success) => {
    if (success) runOnJS(onTap)(id);
  });

  const gesture = Gesture.Race(tap, pan);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
    zIndex: active.value ? 999 : 1,
    elevation: active.value ? 12 : 2,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.chip,
          { borderColor: badgeColor },
          selected && styles.chipSelected,
          animatedStyle,
        ]}
      >
        <Text style={styles.chipText} numberOfLines={1}>
          {title}
        </Text>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.pill,
    borderWidth: 2,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
    maxWidth: 160,
    ...shadows.soft,
  },
  chipSelected: {
    backgroundColor: colors.sandLight,
    transform: [{ scale: 1.05 }],
  },
  chipText: {
    ...typography.caption,
    color: colors.charcoal,
    fontWeight: "700",
  },
});
