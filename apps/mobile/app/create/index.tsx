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
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";

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
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>What are you deciding?</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Friday dinner"
          placeholderTextColor={colors.mist}
          value={topic}
          onChangeText={setTopic}
          maxLength={100}
          autoFocus
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Your display name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Alex"
          placeholderTextColor={colors.mist}
          value={name}
          onChangeText={setName}
          maxLength={30}
        />
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.button,
          loading && styles.buttonDisabled,
          pressed && !loading && styles.buttonPressed,
        ]}
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
    padding: spacing.xl,
    backgroundColor: colors.cream,
  },
  fieldGroup: {
    marginBottom: spacing.xl,
  },
  label: {
    ...typography.bodyBold,
    color: colors.charcoal,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 2,
    borderColor: colors.sand,
    borderRadius: radius.md,
    padding: 14,
    fontSize: 16,
    backgroundColor: colors.warmWhite,
    color: colors.charcoal,
  },
  button: {
    backgroundColor: colors.coral,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    marginTop: spacing.lg,
    ...shadows.button,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonPressed: {
    backgroundColor: colors.coralDark,
    transform: [{ scale: 0.98 }],
  },
  buttonText: {
    color: colors.warmWhite,
    fontSize: 18,
    fontWeight: "700",
  },
});
