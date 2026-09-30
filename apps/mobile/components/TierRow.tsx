import { useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  type LayoutChangeEvent,
} from "react-native";
import { colors, radius, spacing } from "../lib/theme";
import type { TierZone } from "../lib/tiers";

export type ZoneRect = { x: number; y: number; width: number; height: number };

type Props = {
  zone: TierZone;
  labelText: string;
  labelColor: string;
  labelTextColor: string;
  rowBg: string;
  highlighted: boolean;
  selectable: boolean;
  onPress: (zone: TierZone) => void;
  onMeasure: (zone: TierZone, rect: ZoneRect) => void;
  children: React.ReactNode;
  measureNonce?: number;
};

export default function TierRow({
  zone,
  labelText,
  labelColor,
  labelTextColor,
  rowBg,
  highlighted,
  selectable,
  onPress,
  onMeasure,
  children,
  measureNonce,
}: Props) {
  const ref = useRef<View>(null);

  const handleLayout = (_: LayoutChangeEvent) => {
    ref.current?.measureInWindow((x, y, width, height) => {
      onMeasure(zone, { x, y, width, height });
    });
  };

  useEffect(() => {
    ref.current?.measureInWindow((x, y, width, height) => {
      onMeasure(zone, { x, y, width, height });
    });
  }, [measureNonce]);

  return (
    <Pressable
      onPress={() => selectable && onPress(zone)}
      disabled={!selectable}
    >
      <View
        ref={ref}
        onLayout={handleLayout}
        style={[
          styles.row,
          { backgroundColor: rowBg },
          highlighted && styles.rowHighlighted,
        ]}
      >
        <View style={[styles.label, { backgroundColor: labelColor }]}>
          <Text style={[styles.labelText, { color: labelTextColor }]}>
            {labelText}
          </Text>
        </View>
        <View style={styles.chips}>{children}</View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: radius.md,
    marginBottom: spacing.xs,
    minHeight: 52,
    borderWidth: 2,
    borderColor: "transparent",
  },
  rowHighlighted: {
    borderColor: colors.charcoal,
  },
  label: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
    borderTopLeftRadius: radius.md - 2,
    borderBottomLeftRadius: radius.md - 2,
  },
  labelText: {
    fontSize: 20,
    fontWeight: "800",
  },
  chips: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    padding: spacing.sm,
  },
});
