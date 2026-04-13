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
import { useRouter, useLocalSearchParams } from "expo-router";
import { getVoterId } from "../../lib/storage";
import { getRoom } from "../../lib/api";

export default function NameScreen() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    const trimmed = name.trim();
    if (!trimmed) return Alert.alert("Error", "Enter your name");

    setLoading(true);
    try {
      const voterId = await getVoterId();
      const room = await getRoom(code, voterId);

      if (room.status === "open") {
        router.replace({
          pathname: `/room/${code}/lobby`,
          params: { name: trimmed },
        });
      } else if (room.status === "voting") {
        router.replace({
          pathname: `/room/${code}/swipe`,
          params: { name: trimmed },
        });
      } else {
        router.replace({
          pathname: `/room/${code}/results`,
          params: { name: trimmed },
        });
      }
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
      <Text style={styles.heading}>What's your name?</Text>
      <Text style={styles.subheading}>
        This is how others will see you in the room
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Your name"
        value={name}
        onChangeText={setName}
        maxLength={30}
        autoFocus
      />

      <Pressable
        style={[styles.button, (!name.trim() || loading) && styles.buttonDisabled]}
        onPress={handleContinue}
        disabled={!name.trim() || loading}
      >
        <Text style={styles.buttonText}>
          {loading ? "Loading..." : "Continue"}
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
    justifyContent: "center",
  },
  heading: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    textAlign: "center",
  },
  subheading: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 32,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 14,
    fontSize: 18,
    backgroundColor: "#fafafa",
    textAlign: "center",
  },
  button: {
    backgroundColor: "#6C47FF",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 24,
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
