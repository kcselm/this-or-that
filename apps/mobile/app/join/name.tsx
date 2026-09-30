import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { getVoterId, saveActiveRoom } from "../../lib/storage";
import { showAlert } from "../../lib/alert";
import { getRoom, joinRoom } from "../../lib/api";
import { roomScreen } from "../../lib/modes";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";

export default function NameScreen() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    const trimmed = name.trim();
    if (!trimmed) return showAlert("Error", "Enter your name");

    setLoading(true);
    try {
      const voterId = await getVoterId();
      let room = await getRoom(code, voterId);

      // A code from an earlier round forwards to the newest round in the
      // series (the server resolves multi-hop chains to one code).
      let targetCode = code;
      if (room.nextRoomCode) {
        targetCode = room.nextRoomCode;
        room = await getRoom(targetCode, voterId);
      }

      // The API rejects joins on closed/revealed rooms, so check status first.
      if (room.status === "closed") {
        showAlert("Room Closed", "The host closed this room.");
        return;
      }
      if (room.status === "revealed") {
        // Voting is over — show the results without registering as a participant.
        router.replace({
          pathname: "/room/[code]/results",
          params: { code: targetCode, name: trimmed },
        });
        return;
      }

      // Register as a participant
      await joinRoom(targetCode, { voterId, voterName: trimmed });
      await saveActiveRoom({ code: targetCode, topic: room.topic, name: trimmed });

      router.replace({
        pathname: roomScreen(room.status, room.mode, false) ?? "/room/[code]/results",
        params: { code: targetCode, name: trimmed, isCreator: "false" },
      });
    } catch (e: any) {
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
