import { View, Text, StyleSheet } from "react-native";
import { colors, spacing, radius, typography, shadows } from "../lib/theme";

type Props = {
  name: string;
  isYou: boolean;
  isCreator: boolean;
  rankings: { rank: number; itemId: string; title: string }[];
};

export default function RankPlayerCard({ name, isYou, isCreator, rankings }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.name}>{isYou ? `${name} (You)` : name}</Text>
        {isCreator && (
          <View style={styles.hostBadge}>
            <Text style={styles.hostBadgeText}>HOST</Text>
          </View>
        )}
      </View>
      <View style={styles.list}>
        {rankings.map((r) => (
          <View key={r.rank} style={styles.row}>
            <View style={styles.rankBubble}>
              <Text style={styles.rankNumber}>{r.rank}</Text>
            </View>
            <Text style={styles.itemTitle} numberOfLines={1}>
              {r.title}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.soft,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  name: {
    ...typography.bodyBold,
    color: colors.charcoal,
    flex: 1,
  },
  hostBadge: {
    backgroundColor: colors.amberLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  hostBadgeText: {
    ...typography.tiny,
    color: colors.amber,
    fontSize: 9,
  },
  list: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rankBubble: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.coralLight,
    alignItems: "center",
    justifyContent: "center",
  },
  rankNumber: {
    ...typography.caption,
    color: colors.coral,
    fontWeight: "700",
  },
  itemTitle: {
    ...typography.body,
    color: colors.charcoal,
    flex: 1,
  },
});
