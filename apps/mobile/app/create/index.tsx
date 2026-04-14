import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { getVoterId } from "../../lib/storage";
import { createRoom } from "../../lib/api";

export default function CreateRoomScreen() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    const trimmedTopic = topic.trim();
    const trimmedName = name.trim();

    if (!trimmedTopic) return Alert.alert("Error", "Enter a topic");
    if (!trimmedName) return Alert.alert("Error", "Enter your name");

    setLoading(true);
    try {
      const voterId = await getVoterId();
      const room = await createRoom({
        topic: trimmedTopic,
        creatorVoterId: voterId,
        creatorName: trimmedName,
      });
      router.replace({
        pathname: "/create/items",
        params: { code: room.code, name: trimmedName },
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
      <Text style={styles.label}>What are you deciding?</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Friday dinner"
        value={topic}
        onChangeText={setTopic}
        maxLength={100}
        autoFocus
      />

      <Text style={styles.label}>Your display name</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Alex"
        value={name}
        onChangeText={setName}
        maxLength={30}
      />

      <Pressable
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleCreate}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? "Creating..." : "Next"}
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
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    backgroundColor: "#fafafa",
  },
  button: {
    backgroundColor: "#6C47FF",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 32,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
});
