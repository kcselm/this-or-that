import { useRef } from "react";
import { View, Text, StyleSheet, type LayoutChangeEvent } from "react-native";
import { colors, spacing, radius, typography } from "../lib/theme";

export type SlotRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Props = {
  rank: number;
  filledTitle?: string | null;
  highlighted?: boolean;
  onMeasure?: (rank: number, rect: SlotRect) => void;
};

export default function RankSlot({ rank, filledTitle, highlighted, onMeasure }: Props) {
  const ref = useRef<View>(null);

  const handleLayout = (_: LayoutChangeEvent) => {
    ref.current?.measureInWindow((x, y, width, height) => {
      onMeasure?.(rank, { x, y, width, height });
    });
  };

  const filled = !!filledTitle;
  return (
    <View
      ref={ref}
      onLayout={handleLayout}
      style={[styles.slot, filled && styles.slotFilled, highlighted && styles.slotHighlighted]}
    >
      <View style={[styles.rankBadge, filled && styles.rankBadgeFilled]}>
        <Text style={[styles.rankNumber, filled && styles.rankNumberFilled]}>{rank}</Text>
      </View>
      <Text style={[styles.slotText, filled && styles.slotTextFilled]} numberOfLines={1}>
        {filledTitle ?? "—"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.warmWhite,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.sand,
    gap: spacing.md,
  },
  slotFilled: {
    backgroundColor: colors.sandLight,
    borderColor: colors.sand,
    opacity: 0.85,
  },
  slotHighlighted: {
    borderColor: colors.teal,
    backgroundColor: colors.tealLight,
    transform: [{ scale: 1.02 }],
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.coralLight,
    alignItems: "center",
    justifyContent: "center",
  },
  rankBadgeFilled: {
    backgroundColor: colors.sand,
  },
  rankNumber: {
    ...typography.bodyBold,
    color: colors.coral,
  },
  rankNumberFilled: {
    color: colors.slate,
  },
  slotText: {
    ...typography.bodyBold,
    color: colors.mist,
    flex: 1,
  },
  slotTextFilled: {
    color: colors.charcoal,
  },
});
