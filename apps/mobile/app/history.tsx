import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { deleteSavedResult, getSavedResults } from "../lib/storage";
import { headline, RESULTS_RETENTION_DAYS, type SavedResult } from "../lib/saved-results";
import { MODE_TITLES } from "../lib/modes";
import { colors, spacing, radius, typography, shadows } from "../lib/theme";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function PastResultsScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<SavedResult[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      getSavedResults().then(setEntries);
    }, [])
  );

  const handleRemove = async (code: string) => {
    await deleteSavedResult(code);
    setEntries((prev) => prev?.filter((e) => e.code !== code) ?? null);
  };

  const renderEntry = ({ item }: { item: SavedResult }) => {
    const top = headline(item.data);
    return (
      <View style={styles.row}>
        <Pressable
          style={({ pressed }) => [styles.rowContent, pressed && { opacity: 0.7 }]}
          onPress={() =>
            router.push({
              pathname: "/room/[code]/results",
              params: { code: item.code, saved: "1" },
            })
          }
        >
          <View style={styles.rowInfo}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.topic}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {MODE_TITLES[item.mode]} · {formatDate(item.savedAt)}
              {top ? ` · 🏆 ${top}` : ""}
            </Text>
          </View>
          <Text style={styles.rowArrow}>→</Text>
        </Pressable>
        <Pressable
          onPress={() => handleRemove(item.code)}
          hitSlop={8}
          style={({ pressed }) => [styles.removeButton, pressed && { opacity: 0.5 }]}
        >
          <Text style={styles.removeText}>x</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.intro}>
        Results from games you've finished stay on this device for {RESULTS_RETENTION_DAYS} days,
        even after the room is gone.
      </Text>

      <FlatList
        data={entries ?? []}
        keyExtractor={(e) => e.code}
        renderItem={renderEntry}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          entries ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No results yet — finish a game first</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xl,
    backgroundColor: colors.cream,
  },
  intro: {
    ...typography.body,
    color: colors.slate,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  listContent: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.warmWhite,
    borderRadius: radius.md,
    overflow: "hidden",
    ...shadows.soft,
  },
  rowContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    gap: spacing.md,
  },
  rowInfo: {
    flex: 1,
  },
  rowTitle: {
    ...typography.bodyBold,
    color: colors.charcoal,
  },
  rowMeta: {
    ...typography.caption,
    color: colors.mist,
    marginTop: 2,
  },
  rowArrow: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.mist,
  },
  removeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
  },
  removeText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.mist,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: colors.mist,
  },
});
