import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";

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
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
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
  }));

  const yesOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [0, SWIPE_THRESHOLD],
      [0, 1],
      Extrapolation.CLAMP
    ),
  }));

  const noOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [-SWIPE_THRESHOLD, 0],
      [1, 0],
      Extrapolation.CLAMP
    ),
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
    backgroundColor: "#fff",
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#eee",
  },
  content: {
    padding: 24,
    alignItems: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#333",
    textAlign: "center",
  },
  label: {
    position: "absolute",
    top: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 3,
    borderRadius: 8,
  },
  yesLabel: {
    left: 20,
    borderColor: "#48bb78",
  },
  noLabel: {
    right: 20,
    borderColor: "#e53e3e",
  },
  labelText: {
    fontSize: 24,
    fontWeight: "bold",
  },
  yesText: {
    color: "#48bb78",
  },
  noText: {
    color: "#e53e3e",
  },
});
