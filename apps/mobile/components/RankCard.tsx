import { useImperativeHandle, forwardRef } from "react";
import { StyleSheet, Text } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { colors, radius, shadows, typography, spacing } from "../lib/theme";

export type RankCardHandle = {
  flyTo: (point: { x: number; y: number }, onComplete: () => void) => void;
};

type Props = {
  title: string;
  onDragMove: (absX: number, absY: number) => void;
  onDragEnd: (absX: number, absY: number) => void;
};

const RankCard = forwardRef<RankCardHandle, Props>(function RankCard(
  { title, onDragMove, onDragEnd },
  ref
) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  useImperativeHandle(ref, () => ({
    flyTo: (_point, onComplete) => {
      translateX.value = withTiming(translateX.value, { duration: 150 });
      translateY.value = withTiming(translateY.value, { duration: 150 }, () => {
        runOnJS(onComplete)();
      });
    },
  }));

  const gesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
      runOnJS(onDragMove)(e.absoluteX, e.absoluteY);
    })
    .onEnd((e) => {
      runOnJS(onDragEnd)(e.absoluteX, e.absoluteY);
      translateX.value = withSpring(0, { damping: 18, stiffness: 180 });
      translateY.value = withSpring(0, { damping: 18, stiffness: 180 });
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.card, animatedStyle]}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.hint}>drag to a slot</Text>
      </Animated.View>
    </GestureDetector>
  );
});

export default RankCard;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.coralLight,
    ...shadows.card,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: colors.charcoal,
    textAlign: "center",
    letterSpacing: -0.5,
    marginBottom: spacing.sm,
  },
  hint: {
    ...typography.caption,
    color: colors.mist,
  },
});
