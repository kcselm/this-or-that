import { useMemo, useState } from "react";
import { Pressable, Text, View, StyleSheet, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { fitTitle, splitTitle } from "../lib/matchup-text";
import { colors, spacing, radius, shadows } from "../lib/theme";

const PADDING = spacing.lg;

type Props = {
  title: string;
  /** Outer size of the card, so the type can be fitted to it. */
  available: { width: number; height: number };
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export default function MatchupCard({ title, available, selected, disabled, onPress }: Props) {
  const scale = useSharedValue(1);
  // The screen derives `available` from the window; onLayout refines it where
  // it actually fires (native), so both platforms fit the type to real space.
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);

  const box = measured ?? {
    width: available.width - PADDING * 2,
    height: available.height - PADDING * 2,
  };

  const parts = useMemo(() => splitTitle(title), [title]);
  const fit = useMemo(() => fitTitle(title, box.width, box.height), [title, box.width, box.height]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    const next = { width: Math.round(width), height: Math.round(height) };
    if (next.width !== measured?.width || next.height !== measured?.height) setMeasured(next);
  };

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
        accessibilityRole="button"
        accessibilityLabel={title}
        style={({ pressed }) => [
          styles.card,
          selected && styles.cardSelected,
          pressed && !disabled && styles.cardPressed,
        ]}
      >
        <View style={styles.textArea} onLayout={onLayout}>
          <Text
            style={[styles.name, { fontSize: fit.name.fontSize, lineHeight: fit.name.lineHeight }]}
            numberOfLines={fit.name.maxLines}
          >
            {parts.name}
          </Text>
          {parts.note && fit.note && (
            <Text
              style={[
                styles.note,
                {
                  fontSize: fit.note.fontSize,
                  lineHeight: fit.note.lineHeight,
                  marginTop: fit.gap,
                },
              ]}
              numberOfLines={fit.note.maxLines}
            >
              {parts.note}
            </Text>
          )}
        </View>
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
    padding: PADDING,
    overflow: "hidden",
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
  textArea: {
    flex: 1,
    alignSelf: "stretch",
    justifyContent: "center",
  },
  name: {
    fontWeight: "700",
    letterSpacing: -0.3,
    color: colors.charcoal,
    textAlign: "center",
  },
  note: {
    fontWeight: "400",
    color: colors.slate,
    textAlign: "center",
  },
});
