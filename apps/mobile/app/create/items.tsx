import { useState, useRef } from "react";
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
import { useRouter, useLocalSearchParams } from "expo-router";
import { getVoterId } from "../../lib/storage";
import { addItems } from "../../lib/api";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";

export default function AddItemsScreen() {
  const router = useRouter();
  const { code, name } = useLocalSearchParams<{ code: string; name: string }>();
  const [items, setItems] = useState<string[]>([]);
  const [currentItem, setCurrentItem] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const handleAdd = () => {
    const trimmed = currentItem.trim();
    if (!trimmed) return;
    if (items.length >= 15) return Alert.alert("Limit", "Maximum 15 items");
    if (items.includes(trimmed)) return Alert.alert("Duplicate", "That item already exists");
    setItems([...items, trimmed]);
    setCurrentItem("");
  };

  const handleRemove = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleNext = async () => {
    if (items.length < 2) {
      return Alert.alert("Error", "Add at least 2 items");
    }

    setLoading(true);
    try {
      const voterId = await getVoterId();
      await addItems(code, { items, creatorVoterId: voterId });
      router.replace({
        pathname: "/create/share",
        params: { code, name },
      });
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Add your options</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{items.length}/15</Text>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(_, i) => i.toString()}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        renderItem={({ item, index }) => (
          <View style={styles.itemRow}>
            <View style={styles.itemNumber}>
              <Text style={styles.itemNumberText}>{index + 1}</Text>
            </View>
            <Text style={styles.itemText} numberOfLines={1}>
              {item}
            </Text>
            <Pressable
              onPress={() => handleRemove(index)}
              hitSlop={8}
              style={({ pressed }) => [
                styles.removeButton,
                pressed && styles.removeButtonPressed,
              ]}
            >
              <Text style={styles.removeText}>×</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📝</Text>
            <Text style={styles.emptyText}>Add some options to vote on</Text>
          </View>
        }
      />

      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="Type an option..."
          placeholderTextColor={colors.mist}
          value={currentItem}
          onChangeText={setCurrentItem}
          onSubmitEditing={handleAdd}
          blurOnSubmit={false}
          returnKeyType="done"
          maxLength={100}
        />
        <Pressable
          style={({ pressed }) => [
            styles.addButton,
            pressed && styles.addButtonPressed,
          ]}
          onPress={() => { handleAdd(); inputRef.current?.focus(); }}
        >
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.nextButton,
          (items.length < 2 || loading) && styles.buttonDisabled,
          pressed && items.length >= 2 && !loading && styles.nextButtonPressed,
        ]}
        onPress={handleNext}
        disabled={items.length < 2 || loading}
      >
        <Text style={styles.nextButtonText}>
          {loading ? "Saving..." : "Next"}
        </Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xl,
    backgroundColor: colors.cream,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  heading: {
    ...typography.h2,
    color: colors.charcoal,
  },
  countBadge: {
    backgroundColor: colors.coralLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
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
    width: 28,
    height: 28,
    borderRadius: 14,
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
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.coralLight,
    alignItems: "center",
    justifyContent: "center",
  },
  removeButtonPressed: {
    backgroundColor: colors.noBg,
  },
  removeText: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.coral,
    lineHeight: 20,
  },
  emptyState: {
    alignItems: "center",
    marginTop: spacing.xxxl,
    gap: spacing.sm,
  },
  emptyEmoji: {
    fontSize: 40,
  },
  emptyText: {
    ...typography.body,
    color: colors.mist,
  },
  inputRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  input: {
    flex: 1,
    borderWidth: 2,
    borderColor: colors.sand,
    borderRadius: radius.md,
    padding: 14,
    fontSize: 16,
    backgroundColor: colors.warmWhite,
    color: colors.charcoal,
  },
  addButton: {
    backgroundColor: colors.teal,
    width: 52,
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
    fontSize: 26,
    fontWeight: "700",
  },
  nextButton: {
    backgroundColor: colors.coral,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    marginTop: spacing.lg,
    ...shadows.button,
  },
  buttonDisabled: {
    opacity: 0.5,
    shadowOpacity: 0,
  },
  nextButtonPressed: {
    backgroundColor: colors.coralDark,
    transform: [{ scale: 0.98 }],
  },
  nextButtonText: {
    color: colors.warmWhite,
    fontSize: 18,
    fontWeight: "700",
  },
});
