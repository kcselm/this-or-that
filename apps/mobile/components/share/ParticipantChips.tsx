import { View, Text, StyleSheet } from "react-native";
import type { Participant } from "../../lib/api";
import { colors, spacing, radius, typography } from "../../lib/theme";

/** Who has joined so far, as avatar chips. Renders nothing until someone has. */
export default function ParticipantChips({ participants }: { participants: Participant[] }) {
  if (participants.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>IN THE ROOM ({participants.length})</Text>
      <View style={styles.row}>
        {participants.map((p) => (
          <View key={p.participantId} style={styles.chip}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{p.name.charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {p.name}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.md,
  },
  heading: {
    ...typography.tiny,
    color: colors.mist,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.warmWhite,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    gap: spacing.xs,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.coralLight,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.coral,
  },
  name: {
    ...typography.caption,
    color: colors.charcoal,
    maxWidth: 80,
  },
});
