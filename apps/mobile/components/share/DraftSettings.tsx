import { View, Text, StyleSheet, Pressable } from "react-native";
import { DRAFT_ORDERS, DRAFT_ROUNDS, type DraftOrder } from "@tot/shared";
import { colors, spacing, radius, typography } from "../../lib/theme";

type Props = {
  order: DraftOrder;
  rounds: number;
  onChangeOrder: (order: DraftOrder) => void;
  onChangeRounds: (rounds: number) => void;
  disabled?: boolean;
};

const ORDER_LABELS: Record<DraftOrder, string> = {
  snake: "Snake",
  circle: "Circle",
};

const ORDER_HINTS: Record<DraftOrder, string> = {
  snake: "Order reverses every round",
  circle: "Same order every round",
};

/** The host's draft settings: turn order and picks per player. */
export default function DraftSettings({
  order,
  rounds,
  onChangeOrder,
  onChangeRounds,
  disabled = false,
}: Props) {
  const canDecrease = !disabled && rounds > DRAFT_ROUNDS.min;
  const canIncrease = !disabled && rounds < DRAFT_ROUNDS.max;

  return (
    <View style={styles.panel}>
      <Text style={styles.label}>Draft order</Text>
      <View style={styles.segmented} accessibilityRole="radiogroup">
        {DRAFT_ORDERS.map((o) => {
          const selected = o === order;
          return (
            <Pressable
              key={o}
              style={[styles.segment, selected && styles.segmentSelected]}
              onPress={() => !selected && onChangeOrder(o)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityLabel={`${ORDER_LABELS[o]} draft`}
              accessibilityHint={ORDER_HINTS[o]}
              accessibilityState={{ checked: selected, disabled }}
            >
              <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                {ORDER_LABELS[o]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{ORDER_HINTS[order]}</Text>

      <View style={styles.stepperRow}>
        <Text style={[styles.label, styles.stepperLabel]}>Picks per player</Text>
        <View style={styles.stepper}>
          <Pressable
            style={({ pressed }) => [
              styles.stepButton,
              !canDecrease && styles.stepButtonDisabled,
              pressed && canDecrease && styles.stepButtonPressed,
            ]}
            onPress={() => onChangeRounds(rounds - 1)}
            disabled={!canDecrease}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Fewer picks per player"
            accessibilityState={{ disabled: !canDecrease }}
          >
            <Text style={styles.stepButtonText}>−</Text>
          </Pressable>
          <Text
            style={styles.stepValue}
            accessibilityLabel={`${rounds} picks per player`}
            accessibilityLiveRegion="polite"
          >
            {rounds}
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.stepButton,
              !canIncrease && styles.stepButtonDisabled,
              pressed && canIncrease && styles.stepButtonPressed,
            ]}
            onPress={() => onChangeRounds(rounds + 1)}
            disabled={!canIncrease}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="More picks per player"
            accessibilityState={{ disabled: !canIncrease }}
          >
            <Text style={styles.stepButtonText}>+</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.warmWhite,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.xl,
  },
  label: {
    ...typography.bodyBold,
    color: colors.charcoal,
    marginBottom: spacing.sm,
  },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.sandLight,
    borderRadius: radius.md,
    padding: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: "center",
  },
  segmentSelected: {
    backgroundColor: colors.coral,
  },
  segmentText: {
    ...typography.bodyBold,
    color: colors.slate,
  },
  segmentTextSelected: {
    color: colors.warmWhite,
  },
  hint: {
    ...typography.caption,
    color: colors.mist,
    marginTop: spacing.xs,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
  },
  stepperLabel: {
    marginBottom: 0,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.coralLight,
    alignItems: "center",
    justifyContent: "center",
  },
  stepButtonPressed: {
    backgroundColor: colors.sand,
    transform: [{ scale: 0.95 }],
  },
  stepButtonDisabled: {
    opacity: 0.4,
  },
  stepButtonText: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.coral,
  },
  stepValue: {
    ...typography.h3,
    color: colors.charcoal,
    minWidth: 24,
    textAlign: "center",
  },
});
