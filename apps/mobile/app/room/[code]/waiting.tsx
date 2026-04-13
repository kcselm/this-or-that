import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { getStatus, ApiError, type StatusResponse } from "../../../lib/api";

export default function WaitingScreen() {
  const router = useRouter();
  const { code, name } = useLocalSearchParams<{ code: string; name: string }>();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    const poll = async () => {
      try {
        const data = await getStatus(code);
        setStatus(data);
        if (data.isRevealed) {
          clearInterval(intervalRef.current);
          router.replace({
            pathname: `/room/${code}/results`,
            params: { name },
          });
        }
      } catch (e) {
        if (e instanceof ApiError && e.code === "ROOM_NOT_FOUND") {
          clearInterval(intervalRef.current);
          Alert.alert("Room Expired", "This room no longer exists.", [
            { text: "OK", onPress: () => router.replace("/") },
          ]);
        }
      }
    };

    poll();
    intervalRef.current = setInterval(poll, 3000);
    return () => clearInterval(intervalRef.current);
  }, [code, name, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#6C47FF" />
      <Text style={styles.heading}>Waiting for others</Text>

      {status && (
        <>
          <Text style={styles.count}>
            {status.completedCount} of {status.expectedCount} done
          </Text>

          <View style={styles.voterList}>
            {status.voters.map((voter, i) => (
              <View key={i} style={styles.voterRow}>
                <Text style={styles.voterName}>{voter.name}</Text>
                <Text style={voter.completed ? styles.done : styles.pending}>
                  {voter.completed ? "Done" : "Swiping..."}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
      <Pressable style={styles.homeLink} onPress={() => router.replace("/")}>
        <Text style={styles.homeLinkText}>Leave Room</Text>
      </Pressable>
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
    marginBottom: 8,
  },
  count: {
    fontSize: 18,
    color: "#6C47FF",
    fontWeight: "600",
    marginBottom: 24,
  },
  voterList: {
    width: "100%",
    gap: 8,
  },
  voterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f5f3ff",
    padding: 14,
    borderRadius: 10,
  },
  voterName: {
    fontSize: 16,
    color: "#333",
    fontWeight: "500",
  },
  done: {
    fontSize: 14,
    color: "#48bb78",
    fontWeight: "600",
  },
  pending: {
    fontSize: 14,
    color: "#999",
  },
  homeLink: {
    marginTop: 32,
    paddingVertical: 8,
  },
  homeLinkText: {
    color: "#999",
    fontSize: 16,
  },
});
