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
import { getRoom } from "../../lib/api";

export default function JoinScreen() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 6) {
      return Alert.alert("Error", "Enter a 6-character room code");
    }

    setLoading(true);
    try {
      const voterId = await getVoterId();
      await getRoom(trimmed, voterId);
      router.replace({
        pathname: "/join/name",
        params: { code: trimmed },
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
      <Text style={styles.heading}>Enter room code</Text>
      <Text style={styles.subheading}>
        Ask the room creator for their 6-character code
      </Text>

      <TextInput
        style={styles.input}
        placeholder="ABC123"
        value={code}
        onChangeText={(text) => setCode(text.toUpperCase())}
        maxLength={6}
        autoCapitalize="characters"
        autoFocus
        textAlign="center"
      />

      <Pressable
        style={[styles.button, (code.trim().length !== 6 || loading) && styles.buttonDisabled]}
        onPress={handleJoin}
        disabled={code.trim().length !== 6 || loading}
      >
        <Text style={styles.buttonText}>
          {loading ? "Joining..." : "Join"}
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
    borderWidth: 2,
    borderColor: "#6C47FF",
    borderRadius: 12,
    padding: 16,
    fontSize: 28,
    fontWeight: "bold",
    letterSpacing: 8,
    backgroundColor: "#f5f3ff",
    color: "#6C47FF",
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
