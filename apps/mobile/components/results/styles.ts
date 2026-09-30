import { StyleSheet } from "react-native";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";

// Pieces every results view shares: the page, the winner spotlight, the
// topic heading, and the way home.
export const resultStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
    padding: spacing.xl,
  },
  winnerCard: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: "center",
    marginBottom: spacing.lg,
    borderWidth: 2,
    borderColor: colors.amber,
    ...shadows.card,
  },
  winnerLabel: {
    ...typography.tiny,
    color: colors.amber,
    marginBottom: spacing.sm,
  },
  winnerTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: colors.charcoal,
    textAlign: "center",
    letterSpacing: -0.5,
    marginBottom: spacing.md,
  },
  topic: {
    ...typography.h3,
    color: colors.charcoal,
    textAlign: "center",
  },
  meta: {
    ...typography.caption,
    color: colors.mist,
    textAlign: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  homeLink: {
    paddingVertical: spacing.sm,
  },
  homeLinkText: {
    ...typography.body,
    color: colors.coral,
  },
  homeButton: {
    backgroundColor: colors.coral,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    marginTop: spacing.sm,
    ...shadows.button,
  },
  homeButtonPressed: {
    backgroundColor: colors.coralDark,
    transform: [{ scale: 0.98 }],
  },
  homeButtonText: {
    color: colors.warmWhite,
    fontSize: 18,
    fontWeight: "700",
  },
});

export type ResultsViewProps<T> = {
  data: T;
  homeLabel: string;
  onHome: () => void;
};
