import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  interpolateColor,
  Extrapolation,
} from "react-native-reanimated";
import { colors, radius, shadows } from "../lib/theme";

type Props = {
  title: string;
  onSwipe: (direction: "yes" | "no") => void;
};

const SWIPE_THRESHOLD = 120;

export default function SwipeCard({ title, onSwipe }: Props) {
  const { width } = useWindowDimensions();
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const gesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY * 0.3;
    })
    .onEnd((e) => {
      if (e.translationX > SWIPE_THRESHOLD) {
        translateX.value = withTiming(width + 100, { duration: 200 });
        runOnJS(onSwipe)("yes");
      } else if (e.translationX < -SWIPE_THRESHOLD) {
        translateX.value = withTiming(-width - 100, { duration: 200 });
        runOnJS(onSwipe)("no");
      } else {
        translateX.value = withSpring(0, { damping: 15, stiffness: 150 });
        translateY.value = withSpring(0, { damping: 15, stiffness: 150 });
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      {
        rotate: `${interpolate(
          translateX.value,
          [-width, 0, width],
          [-15, 0, 15],
          Extrapolation.CLAMP
        )}deg`,
      },
    ],
    backgroundColor: interpolateColor(
      translateX.value,
      [-SWIPE_THRESHOLD * 2, 0, SWIPE_THRESHOLD * 2],
      [colors.noBg, "#FFFFFF", colors.yesBg]
    ),
    borderColor: interpolateColor(
      translateX.value,
      [-SWIPE_THRESHOLD * 1.5, -SWIPE_THRESHOLD * 0.5, 0, SWIPE_THRESHOLD * 0.5, SWIPE_THRESHOLD * 1.5],
      [colors.no, colors.sand, colors.sand, colors.sand, colors.yes]
    ),
  }));

  const yesOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [0, SWIPE_THRESHOLD],
      [0, 1],
      Extrapolation.CLAMP
    ),
    transform: [
      {
        scale: interpolate(
          translateX.value,
          [0, SWIPE_THRESHOLD],
          [0.5, 1],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  const noOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [-SWIPE_THRESHOLD, 0],
      [1, 0],
      Extrapolation.CLAMP
    ),
    transform: [
      {
        scale: interpolate(
          translateX.value,
          [-SWIPE_THRESHOLD, 0],
          [1, 0.5],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.card, cardStyle]}>
        <Animated.View style={[styles.label, styles.yesLabel, yesOpacity]}>
          <Text style={[styles.labelText, styles.yesText]}>YES</Text>
        </Animated.View>
        <Animated.View style={[styles.label, styles.noLabel, noOpacity]}>
          <Text style={[styles.labelText, styles.noText]}>NO</Text>
        </Animated.View>
        <View style={styles.content}>
          <Text style={styles.title}>{title}</Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    width: "90%",
    aspectRatio: 0.85,
    backgroundColor: colors.warmWhite,
    borderRadius: radius.xxl,
    borderWidth: 2,
    borderColor: colors.sand,
    justifyContent: "center",
    alignItems: "center",
    ...shadows.card,
  },
  content: {
    padding: 24,
    alignItems: "center",
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    color: colors.charcoal,
    textAlign: "center",
    letterSpacing: -0.5,
  },
  label: {
    position: "absolute",
    top: 28,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderWidth: 3,
    borderRadius: radius.md,
  },
  yesLabel: {
    left: 22,
    borderColor: colors.teal,
    backgroundColor: colors.tealLight,
  },
  noLabel: {
    right: 22,
    borderColor: colors.coral,
    backgroundColor: colors.coralLight,
  },
  labelText: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 2,
  },
  yesText: {
    color: colors.teal,
  },
  noText: {
    color: colors.coral,
  },
});
