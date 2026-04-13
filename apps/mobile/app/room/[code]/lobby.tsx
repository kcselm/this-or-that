import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { getRoom } from "../../../lib/api";
import { getVoterId } from "../../../lib/storage";

export default function LobbyScreen() {
  const router = useRouter();
  const { code, name } = useLocalSearchParams<{ code: string; name: string }>();
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    const poll = async () => {
      try {
        const voterId = await getVoterId();
        const room = await getRoom(code, voterId);
        if (room.status === "voting") {
          clearInterval(intervalRef.current);
          router.replace({
            pathname: `/room/${code}/swipe`,
            params: { name },
          });
        } else if (room.status === "revealed") {
          clearInterval(intervalRef.current);
          router.replace({
            pathname: `/room/${code}/results`,
            params: { name },
          });
        }
      } catch {}
    };

    poll();
    intervalRef.current = setInterval(poll, 3000);
    return () => clearInterval(intervalRef.current);
  }, [code, name, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#6C47FF" />
      <Text style={styles.heading}>Waiting for host</Text>
      <Text style={styles.subheading}>
        The host is still setting up the room. Voting will start soon...
      </Text>
      <View style={styles.codeBox}>
        <Text style={styles.codeLabel}>Room Code</Text>
        <Text style={styles.code}>{code}</Text>
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
  heading: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginTop: 24,
  },
  subheading: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 32,
  },
  codeBox: {
    alignItems: "center",
  },
  codeLabel: {
    fontSize: 14,
    color: "#999",
    marginBottom: 4,
  },
  code: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#6C47FF",
    letterSpacing: 4,
  },
});
