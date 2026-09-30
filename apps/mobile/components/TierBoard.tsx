import { View, Text, StyleSheet } from "react-native";
import { colors, radius, spacing, typography } from "../lib/theme";
import { TIERS, TIER_META } from "../lib/tiers";
import type { Tier } from "../lib/api";

type Props = {
  rows: { tier: Tier; titles: string[] }[];
};

export default function TierBoard({ rows }: Props) {
  const titlesByTier = new Map(rows.map((r) => [r.tier, r.titles]));

  return (
    <View style={styles.board}>
      {TIERS.map((tier) => {
        const meta = TIER_META[tier];
        const titles = titlesByTier.get(tier) ?? [];
        return (
          <View key={tier} style={[styles.row, { backgroundColor: meta.rowBg }]}>
            <View style={[styles.label, { backgroundColor: meta.badge }]}>
              <Text style={[styles.labelText, { color: meta.text }]}>{meta.label}</Text>
            </View>
            <View style={styles.chips}>
              {titles.length === 0 ? (
                <Text style={styles.empty}>—</Text>
              ) : (
                titles.map((title, i) => (
                  <View key={`${title}-${i}`} style={styles.chip}>
                    <Text style={styles.chipText} numberOfLines={1}>
                      {title}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: radius.md,
    minHeight: 52,
  },
  label: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
    borderTopLeftRadius: radius.md,
    borderBottomLeftRadius: radius.md,
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
  chip: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.sand,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
    maxWidth: 160,
  },
  chipText: {
    ...typography.caption,
    color: colors.charcoal,
    fontWeight: "700",
  },
  empty: {
    ...typography.body,
    color: colors.mist,
  },
});
