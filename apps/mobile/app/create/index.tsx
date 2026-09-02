import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from "react-native";
import { showAlert } from "../../lib/alert";
import { useRouter, useLocalSearchParams } from "expo-router";
import { getVoterId } from "../../lib/storage";
import { createRoom } from "../../lib/api";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";

export default function CreateRoomScreen() {
  const router = useRouter();
  const { mode: modeParam, previousRoomCode, name: nameParam } = useLocalSearchParams<{
    mode?: string;
    previousRoomCode?: string;
    name?: string;
  }>();
  const mode: "vote" | "rank" | "bracket" | "mlt" | "tier" =
    modeParam === "rank"
      ? "rank"
      : modeParam === "bracket"
        ? "bracket"
        : modeParam === "mlt"
          ? "mlt"
          : modeParam === "tier"
            ? "tier"
            : "vote";
  const [topic, setTopic] = useState("");
  const [name, setName] = useState(nameParam ?? "");
  const [allowSuggestions, setAllowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    const trimmedTopic = topic.trim();
    const trimmedName = name.trim();

    if (!trimmedTopic) return showAlert("Error", "Enter a topic");
    if (!trimmedName) return showAlert("Error", "Enter your name");

    setLoading(true);
    try {
      const voterId = await getVoterId();
      const room = await createRoom({
        topic: trimmedTopic,
        creatorVoterId: voterId,
        creatorName: trimmedName,
        allowSuggestions: mode === "vote" ? allowSuggestions : false,
        mode,
        ...(previousRoomCode ? { previousRoomCode } : {}),
      });
      if (mode === "mlt") {
        router.replace({
          pathname: "/create/mlt-prompts",
          params: { code: room.code, name: trimmedName, mode },
        });
      } else {
        router.replace({
          pathname: "/create/share",
          params: { code: room.code, name: trimmedName, mode },
        });
      }
    } catch (e: any) {
      if (previousRoomCode && (e.code === "NOT_NEXT_HOST" || e.code === "SERIES_CONTINUED")) {
        // The pick changed (or the round already exists) while we were typing.
        showAlert("Round moved on", e.message, () =>
          router.replace({
            pathname: "/room/[code]/results",
            params: { code: previousRoomCode, name: trimmedName },
          })
        );
        return;
      }
      showAlert("Error", e.message);
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
        <Text style={styles.label}>
          {previousRoomCode ? "What's the next category?" : "What are you deciding?"}
        </Text>
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

      {!nameParam && (
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
      )}

      {mode === "vote" && (
        <View style={styles.toggleRow}>
          <View style={styles.toggleLabel}>
            <Text style={styles.label}>Let others add items</Text>
            <Text style={styles.toggleHint}>
              Friends can suggest options after joining
            </Text>
          </View>
          <Switch
            value={allowSuggestions}
            onValueChange={setAllowSuggestions}
            trackColor={{ false: colors.sand, true: colors.tealLight }}
            thumbColor={allowSuggestions ? colors.teal : colors.mist}
          />
        </View>
      )}

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
          {loading ? "Creating..." : "Create Room"}
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
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.warmWhite,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.xl,
  },
  toggleLabel: {
    flex: 1,
    marginRight: spacing.md,
  },
  toggleHint: {
    ...typography.caption,
    color: colors.mist,
    marginTop: 2,
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
