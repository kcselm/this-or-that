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
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";

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
      <View style={styles.content}>
        <Text style={styles.heading}>Enter room code</Text>
        <Text style={styles.subheading}>
          Ask the room creator for their 6-character code
        </Text>

        <View style={styles.inputCard}>
          <TextInput
            style={styles.input}
            placeholder="ABC123"
            placeholderTextColor={colors.sand}
            value={code}
            onChangeText={(text) => setCode(text.toUpperCase())}
            maxLength={6}
            autoCapitalize="characters"
            autoFocus
            textAlign="center"
          />
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.button,
            (code.trim().length !== 6 || loading) && styles.buttonDisabled,
            pressed && code.trim().length === 6 && !loading && styles.buttonPressed,
          ]}
          onPress={handleJoin}
          disabled={code.trim().length !== 6 || loading}
        >
          <Text style={styles.buttonText}>
            {loading ? "Joining..." : "Join"}
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
  inputCard: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.card,
  },
  input: {
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: 8,
    color: colors.coral,
    padding: spacing.lg,
  },
  button: {
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
