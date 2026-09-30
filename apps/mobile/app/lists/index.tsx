import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { createSavedList, getSavedLists } from "../../lib/storage";
import type { SavedList } from "../../lib/saved-lists";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";

export default function SavedListsScreen() {
  const router = useRouter();
  const [lists, setLists] = useState<SavedList[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      getSavedLists().then(setLists);
    }, [])
  );

  const handleNew = async () => {
    const list = await createSavedList();
    router.push({ pathname: "/lists/[id]", params: { id: list.id } });
  };

  const renderList = ({ item }: { item: SavedList }) => (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => router.push({ pathname: "/lists/[id]", params: { id: item.id } })}
    >
      <View style={styles.rowInfo}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.name.trim() || "Untitled list"}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {item.items.length} {item.items.length === 1 ? "item" : "items"}
          {item.items.length > 0 ? ` · ${item.items.slice(0, 3).join(", ")}` : ""}
        </Text>
      </View>
      <Text style={styles.rowArrow}>→</Text>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.intro}>
        Build a list ahead of time. It's saved on this device, and you can load it into any room you
        host.
      </Text>

      <Pressable
        style={({ pressed }) => [styles.newButton, pressed && styles.newButtonPressed]}
        onPress={handleNew}
      >
        <Text style={styles.newButtonText}>New List</Text>
      </Pressable>

      <FlatList
        data={lists ?? []}
        keyExtractor={(l) => l.id}
        renderItem={renderList}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          lists ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No saved lists yet</Text>
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
  newButton: {
    backgroundColor: colors.coral,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    marginBottom: spacing.xl,
    ...shadows.button,
  },
  newButtonPressed: {
    backgroundColor: colors.coralDark,
    transform: [{ scale: 0.98 }],
  },
  newButtonText: {
    color: colors.warmWhite,
    fontSize: 18,
    fontWeight: "700",
  },
  listContent: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.warmWhite,
    padding: spacing.lg,
    borderRadius: radius.md,
    gap: spacing.md,
    ...shadows.soft,
  },
  rowPressed: {
    backgroundColor: colors.sandLight,
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
  emptyState: {
    alignItems: "center",
    paddingVertical: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: colors.mist,
  },
});
