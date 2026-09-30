import { useRef, useState } from "react";
import { View, Text, TextInput, StyleSheet, Pressable, FlatList, ScrollView } from "react-native";
import type { RoomItem } from "../../lib/api";
import type { SavedList } from "../../lib/saved-lists";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";

type Props = {
  items: RoomItem[];
  maxItems: number;
  maxItemLength: number;
  /** Add one item; resolves true once it's saved so the input can clear. */
  onAdd: (title: string) => Promise<boolean>;
  onDelete: (itemId: string) => void;
  savedLists: SavedList[];
  importing: boolean;
  onImport: (list: SavedList) => void;
  onSaveAsList: () => void;
};

/** The host's editable item list: add, remove, load from or save to My Lists. */
export default function ItemEditor({
  items,
  maxItems,
  maxItemLength,
  onAdd,
  onDelete,
  savedLists,
  importing,
  onImport,
  onSaveAsList,
}: Props) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<TextInput>(null);

  const submit = async () => {
    if (await onAdd(draft)) setDraft("");
  };

  const renderItem = ({ item, index }: { item: RoomItem; index: number }) => (
    <View style={styles.itemRow}>
      <View style={styles.itemNumber}>
        <Text style={styles.itemNumberText}>{index + 1}</Text>
      </View>
      <View style={styles.itemInfo}>
        <Text style={styles.itemText} numberOfLines={1}>
          {item.title}
        </Text>
        {item.addedBy && <Text style={styles.addedByText}>Added by {item.addedBy.name}</Text>}
      </View>
      <Pressable
        onPress={() => onDelete(item.id)}
        hitSlop={8}
        style={({ pressed }) => [styles.removeButton, pressed && styles.removeButtonPressed]}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.title}`}
      >
        <Text style={styles.removeText}>x</Text>
      </Pressable>
    </View>
  );

  const importable = savedLists.filter((l) => l.items.length > 0);

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.heading}>OPTIONS</Text>
        <View style={styles.headerRight}>
          {items.length > 0 && (
            <Pressable onPress={onSaveAsList} hitSlop={8} accessibilityRole="button">
              {({ pressed }) => (
                <Text style={[styles.saveListText, pressed && { opacity: 0.6 }]}>Save to My Lists</Text>
              )}
            </Pressable>
          )}
          <View style={styles.countBadge}>
            <Text style={styles.countText} accessibilityLabel={`${items.length} of ${maxItems} items`}>
              {items.length}/{maxItems}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="Type an option..."
          placeholderTextColor={colors.mist}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          blurOnSubmit={false}
          returnKeyType="done"
          maxLength={maxItemLength}
          accessibilityLabel="New option"
        />
        <Pressable
          style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
          onPress={() => {
            submit();
            inputRef.current?.focus();
          }}
          accessibilityRole="button"
          accessibilityLabel="Add option"
        >
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View>

      {importable.length > 0 && items.length < maxItems && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.listChips}
          contentContainerStyle={styles.listChipsContent}
        >
          <Text style={styles.listChipsLabel}>LOAD LIST</Text>
          {importable.map((l) => (
            <Pressable
              key={l.id}
              disabled={importing}
              onPress={() => onImport(l)}
              style={({ pressed }) => [styles.listChip, (pressed || importing) && styles.listChipPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Load list ${l.name.trim() || "Untitled list"}, ${l.items.length} items`}
            >
              <Text style={styles.listChipText} numberOfLines={1}>
                {l.name.trim() || "Untitled list"} · {l.items.length}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No items yet — add some above</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    flex: 1,
    minHeight: 80,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  heading: {
    ...typography.tiny,
    color: colors.mist,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  saveListText: {
    ...typography.caption,
    color: colors.teal,
    fontWeight: "700",
  },
  listChips: {
    flexGrow: 0,
    marginBottom: spacing.sm,
  },
  listChipsContent: {
    alignItems: "center",
    gap: spacing.sm,
  },
  listChipsLabel: {
    ...typography.tiny,
    color: colors.mist,
  },
  listChip: {
    backgroundColor: colors.tealLight,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    maxWidth: 200,
  },
  listChipPressed: {
    opacity: 0.6,
  },
  listChipText: {
    ...typography.caption,
    color: colors.tealDark,
    fontWeight: "700",
  },
  countBadge: {
    backgroundColor: colors.coralLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  countText: {
    ...typography.caption,
    color: colors.coral,
    fontWeight: "700",
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: spacing.sm,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.warmWhite,
    padding: spacing.md,
    borderRadius: radius.md,
    gap: spacing.md,
    ...shadows.soft,
  },
  itemNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.sandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  itemNumberText: {
    ...typography.caption,
    color: colors.slate,
    fontWeight: "700",
  },
  itemInfo: {
    flex: 1,
  },
  itemText: {
    ...typography.body,
    color: colors.charcoal,
  },
  addedByText: {
    ...typography.caption,
    color: colors.mist,
    marginTop: 1,
  },
  removeButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.coralLight,
    alignItems: "center",
    justifyContent: "center",
  },
  removeButtonPressed: {
    backgroundColor: colors.noBg,
  },
  removeText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.coral,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: colors.mist,
  },
  inputRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  input: {
    flex: 1,
    borderWidth: 2,
    borderColor: colors.sand,
    borderRadius: radius.md,
    padding: 12,
    fontSize: 16,
    backgroundColor: colors.warmWhite,
    color: colors.charcoal,
  },
  addButton: {
    backgroundColor: colors.teal,
    width: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonPressed: {
    backgroundColor: colors.tealDark,
    transform: [{ scale: 0.95 }],
  },
  addButtonText: {
    color: colors.warmWhite,
    fontSize: 24,
    fontWeight: "700",
  },
});
