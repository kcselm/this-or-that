import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";

export default function HomeScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>This or That</Text>
      <Text style={styles.subtitle}>Swipe to decide, together.</Text>

      <View style={styles.buttons}>
        <Pressable
          style={[styles.button, styles.createButton]}
          onPress={() => router.push("/create")}
        >
          <Text style={styles.buttonText}>Create a Room</Text>
        </Pressable>

        <Pressable
          style={[styles.button, styles.joinButton]}
          onPress={() => router.push("/join")}
        >
          <Text style={[styles.buttonText, styles.joinButtonText]}>Join a Room</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#6C47FF",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: "#666",
    marginBottom: 48,
  },
  buttons: {
    width: "100%",
    gap: 16,
  },
  button: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  createButton: {
    backgroundColor: "#6C47FF",
  },
  joinButton: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#6C47FF",
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  joinButtonText: {
    color: "#6C47FF",
  },
});
