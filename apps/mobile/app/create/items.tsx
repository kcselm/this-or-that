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
      <Text style={styles.heading}>Add your options</Text>
      <Text style={styles.subheading}>{items.length}/15 items</Text>

      <FlatList
        data={items}
        keyExtractor={(_, i) => i.toString()}
        style={styles.list}
        renderItem={({ item, index }) => (
          <View style={styles.itemRow}>
            <Text style={styles.itemText} numberOfLines={1}>
              {item}
            </Text>
            <Pressable onPress={() => handleRemove(index)} hitSlop={8}>
              <Text style={styles.removeText}>X</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No items yet. Add some below.</Text>
        }
      />

      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="Type an option..."
          value={currentItem}
          onChangeText={setCurrentItem}
          onSubmitEditing={handleAdd}
          blurOnSubmit={false}
          returnKeyType="done"
          maxLength={100}
        />
        <Pressable style={styles.addButton} onPress={() => { handleAdd(); inputRef.current?.focus(); }}>
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View>

      <Pressable
        style={[styles.nextButton, (items.length < 2 || loading) && styles.buttonDisabled]}
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
    padding: 24,
    backgroundColor: "#fff",
  },
  heading: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#333",
  },
  subheading: {
    fontSize: 14,
    color: "#999",
    marginTop: 4,
    marginBottom: 16,
  },
  list: {
    flex: 1,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f5f3ff",
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
  },
  itemText: {
    fontSize: 16,
    color: "#333",
    flex: 1,
    marginRight: 12,
  },
  removeText: {
    fontSize: 16,
    color: "#e53e3e",
    fontWeight: "bold",
  },
  emptyText: {
    color: "#999",
    textAlign: "center",
    marginTop: 32,
  },
  inputRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    backgroundColor: "#fafafa",
  },
  addButton: {
    backgroundColor: "#6C47FF",
    width: 50,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonText: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "bold",
  },
  nextButton: {
    backgroundColor: "#6C47FF",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  nextButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
});
