import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import { deleteSavedList, getSavedList, updateSavedList } from "../../lib/storage";
import { appendEntries, splitEntries, MAX_LIST_ITEMS } from "../../lib/saved-lists";
import { showAlert } from "../../lib/alert";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";

export default function SavedListEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<TextInput>(null);

  // Mirrors of the latest values for the unmount cleanup below.
  const latest = useRef({ name, items });
  latest.current = { name, items };

  useEffect(() => {
    getSavedList(id).then((list) => {
      if (!list) {
        showAlert("List not found", undefined, () => router.back());
        return;
      }
      setName(list.name);
      setItems(list.items);
      setLoaded(true);
    });
    // A list opened via "New List" and left untouched shouldn't linger.
    return () => {
      if (!latest.current.name.trim() && latest.current.items.length === 0) {
        deleteSavedList(id);
      }
    };
  }, [id]);

  const handleNameChange = (value: string) => {
    setName(value);
    updateSavedList(id, { name: value });
  };

  const saveItems = (next: string[]) => {
    setItems(next);
    updateSavedList(id, { items: next });
  };

  const addEntries = (entries: string[]) => {
    if (entries.length === 0) return;
    const res = appendEntries(items, entries);
    if (res.items.length !== items.length) saveItems(res.items);
    setDraft("");
    if (res.overflow > 0) {
      showAlert("Limit", `Lists hold up to ${MAX_LIST_ITEMS} items`);
    } else if (res.duplicates > 0 && entries.length === 1) {
      showAlert("Duplicate", "That item is already on the list");
    }
  };

  // Pasting several lines at once adds each line as its own item.
  const handleDraftChange = (value: string) => {
    if (value.includes("\n")) {
      addEntries(splitEntries(value));
    } else {
      setDraft(value);
    }
  };

  const handleRemove = (index: number) => {
    saveItems(items.filter((_, i) => i !== index));
  };

  const handleDeleteList = async () => {
    const confirmed =
      Platform.OS === "web"
        ? window.confirm("Delete this list?")
        : await new Promise<boolean>((resolve) =>
            Alert.alert("Delete List", "Delete this list?", [
              { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
              { text: "Delete", style: "destructive", onPress: () => resolve(true) },
            ])
          );
    if (!confirmed) return;
    await deleteSavedList(id);
    router.back();
  };

  const handlePlay = () => {
    if (items.length === 0) return showAlert("Empty list", "Add some items first");
    router.push({ pathname: "/create/mode", params: { listId: id } });
  };

  const renderItem = ({ item, index }: { item: string; index: number }) => (
    <View style={styles.itemRow}>
      <View style={styles.itemNumber}>
        <Text style={styles.itemNumberText}>{index + 1}</Text>
      </View>
      <Text style={styles.itemText} numberOfLines={2}>
        {item}
      </Text>
      <Pressable
        onPress={() => handleRemove(index)}
        hitSlop={8}
        style={({ pressed }) => [styles.removeButton, pressed && styles.removeButtonPressed]}
      >
        <Text style={styles.removeText}>x</Text>
      </Pressable>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Stack.Screen options={{ title: name.trim() || "New List" }} />

      <TextInput
        style={styles.nameInput}
        placeholder="List name, e.g. Movie night picks"
        placeholderTextColor={colors.mist}
        value={name}
        onChangeText={handleNameChange}
        maxLength={100}
        editable={loaded}
        autoFocus={loaded && !name}
      />

      <View style={styles.itemsHeader}>
        <Text style={styles.sectionHeading}>ITEMS</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>
            {items.length}/{MAX_LIST_ITEMS}
          </Text>
        </View>
      </View>

      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="Type an item, or paste a list..."
          placeholderTextColor={colors.mist}
          value={draft}
          onChangeText={handleDraftChange}
          onSubmitEditing={() => addEntries(splitEntries(draft))}
          multiline
          submitBehavior="submit"
          returnKeyType="done"
          editable={loaded}
        />
        <Pressable
          style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
          onPress={() => {
            addEntries(splitEntries(draft));
            inputRef.current?.focus();
          }}
        >
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>Saved automatically on this device.</Text>

      <FlatList
        data={items}
        keyExtractor={(item) => item}
        renderItem={renderItem}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          loaded ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No items yet — add some above</Text>
            </View>
          ) : null
        }
      />

      <View style={styles.bottomSection}>
        <Pressable
          style={({ pressed }) => [
            styles.playButton,
            items.length === 0 && styles.buttonDisabled,
            pressed && items.length > 0 && styles.playButtonPressed,
          ]}
          onPress={handlePlay}
          disabled={items.length === 0}
        >
          <Text style={styles.playButtonText}>Host a Room With This List</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.deleteLink, pressed && { opacity: 0.6 }]}
          onPress={handleDeleteList}
        >
          <Text style={styles.deleteLinkText}>Delete List</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xl,
    backgroundColor: colors.cream,
  },
  nameInput: {
    borderWidth: 2,
    borderColor: colors.sand,
    borderRadius: radius.md,
    padding: 14,
    fontSize: 18,
    fontWeight: "700",
    backgroundColor: colors.warmWhite,
    color: colors.charcoal,
    marginBottom: spacing.lg,
  },
  itemsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  sectionHeading: {
    ...typography.tiny,
    color: colors.mist,
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
  inputRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    borderWidth: 2,
    borderColor: colors.sand,
    borderRadius: radius.md,
    padding: 12,
    fontSize: 16,
    maxHeight: 120,
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
  hint: {
    ...typography.caption,
    color: colors.mist,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
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
  itemText: {
    ...typography.body,
    color: colors.charcoal,
    flex: 1,
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
  bottomSection: {
    paddingTop: spacing.md,
  },
  playButton: {
    backgroundColor: colors.coral,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    ...shadows.button,
  },
  playButtonPressed: {
    backgroundColor: colors.coralDark,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    opacity: 0.5,
    shadowOpacity: 0,
  },
  playButtonText: {
    color: colors.warmWhite,
    fontSize: 18,
    fontWeight: "700",
  },
  deleteLink: {
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  deleteLinkText: {
    ...typography.body,
    color: colors.mist,
  },
});
