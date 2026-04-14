import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { getStatus, revealResults, ApiError, type StatusResponse } from "../../../lib/api";
import { getVoterId } from "../../../lib/storage";

export default function WaitingScreen() {
  const router = useRouter();
  const { code, name, isCreator: isCreatorParam } = useLocalSearchParams<{
    code: string;
    name: string;
    isCreator?: string;
  }>();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [revealing, setRevealing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const isCreator = isCreatorParam === "true";

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
            {status.completedCount} of {status.totalVoters} done
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
      {isCreator && status && status.completedCount > 0 && (
        <Pressable
          style={[styles.revealButton, revealing && styles.buttonDisabled]}
          onPress={async () => {
            setRevealing(true);
            try {
              const voterId = await getVoterId();
              await revealResults(code, voterId);
              router.replace({
                pathname: `/room/${code}/results`,
                params: { name },
              });
            } catch (e: any) {
              Alert.alert("Error", e.message);
              setRevealing(false);
            }
          }}
          disabled={revealing}
        >
          <Text style={styles.revealButtonText}>
            {revealing ? "Revealing..." : "Reveal Results"}
          </Text>
        </Pressable>
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
  revealButton: {
    backgroundColor: "#6C47FF",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 24,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  revealButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
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
