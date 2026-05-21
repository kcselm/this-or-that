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
import { getVoterId, saveActiveRoom } from "../../lib/storage";
import { getRoom, joinRoom } from "../../lib/api";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";

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

      // Register as a participant
      await joinRoom(code, { voterId, voterName: trimmed });
      await saveActiveRoom({ code, topic: room.topic, name: trimmed });

      if (room.status === "closed") {
        Alert.alert("Room Closed", "The host closed this room.");
        return;
      } else if (room.status === "open") {
        router.replace({
          pathname: "/room/[code]/lobby",
          params: { code, name: trimmed },
        });
      } else if (room.status === "voting") {
        router.replace({
          pathname:
            room.mode === "rank" ? "/room/[code]/rank" :
            room.mode === "bracket" ? "/room/[code]/bracket" :
            room.mode === "mlt" ? "/room/[code]/mlt" :
            "/room/[code]/swipe",
          params: { code, name: trimmed, isCreator: "false" },
        });
      } else {
        router.replace({
          pathname: "/room/[code]/results",
          params: { code, name: trimmed },
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
      <View style={styles.content}>
        <View style={styles.avatarPreview}>
          <Text style={styles.avatarText}>
            {name.trim() ? name.trim().charAt(0).toUpperCase() : "?"}
          </Text>
        </View>

        <Text style={styles.heading}>What's your name?</Text>
        <Text style={styles.subheading}>
          This is how others will see you in the room
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Your name"
          placeholderTextColor={colors.mist}
          value={name}
          onChangeText={setName}
          maxLength={30}
          autoFocus
          textAlign="center"
        />

        <Pressable
          style={({ pressed }) => [
            styles.button,
            (!name.trim() || loading) && styles.buttonDisabled,
            pressed && name.trim() && !loading && styles.buttonPressed,
          ]}
          onPress={handleContinue}
          disabled={!name.trim() || loading}
        >
          <Text style={styles.buttonText}>
            {loading ? "Loading..." : "Continue"}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  content: {
    flex: 1,
    padding: spacing.xl,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarPreview: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.coralLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xl,
  },
  avatarText: {
    fontSize: 30,
    fontWeight: "800",
    color: colors.coral,
  },
  heading: {
    ...typography.h1,
    color: colors.charcoal,
    textAlign: "center",
  },
  subheading: {
    ...typography.body,
    color: colors.slate,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xxl,
  },
  input: {
    width: "100%",
    borderWidth: 2,
    borderColor: colors.sand,
    borderRadius: radius.md,
    padding: 14,
    fontSize: 18,
    backgroundColor: colors.warmWhite,
    color: colors.charcoal,
    fontWeight: "600",
  },
  button: {
    width: "100%",
    backgroundColor: colors.coral,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    marginTop: spacing.xl,
    ...shadows.button,
  },
  buttonDisabled: {
    opacity: 0.5,
    shadowOpacity: 0,
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
