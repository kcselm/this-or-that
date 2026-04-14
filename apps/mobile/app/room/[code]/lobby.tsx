import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { getRoom, getParticipants, ApiError, type Participant } from "../../../lib/api";
import { getVoterId } from "../../../lib/storage";

export default function LobbyScreen() {
  const router = useRouter();
  const { code, name } = useLocalSearchParams<{ code: string; name: string }>();
  const [participants, setParticipants] = useState<Participant[]>([]);
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
          return;
        } else if (room.status === "revealed") {
          clearInterval(intervalRef.current);
          router.replace({
            pathname: `/room/${code}/results`,
            params: { name },
          });
          return;
        }

        // Fetch participant list
        const data = await getParticipants(code);
        setParticipants(data.participants);
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
      <Text style={styles.heading}>Waiting for host</Text>
      <Text style={styles.subheading}>
        The host is still setting up the room. Voting will start soon...
      </Text>

      {participants.length > 0 && (
        <View style={styles.participantSection}>
          <Text style={styles.participantHeading}>
            In the room ({participants.length})
          </Text>
          <View style={styles.participantList}>
            {participants.map((p) => (
              <View key={p.voterId} style={styles.participantRow}>
                <Text style={styles.participantName}>{p.name}</Text>
                {p.isCreator && <Text style={styles.hostBadge}>Host</Text>}
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={styles.codeBox}>
        <Text style={styles.codeLabel}>Room Code</Text>
        <Text style={styles.code}>{code}</Text>
      </View>
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
  },
  subheading: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 24,
  },
  participantSection: {
    width: "100%",
    marginBottom: 24,
  },
  participantHeading: {
    fontSize: 14,
    fontWeight: "600",
    color: "#999",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  participantList: {
    gap: 8,
  },
  participantRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f5f3ff",
    padding: 14,
    borderRadius: 10,
  },
  participantName: {
    fontSize: 16,
    color: "#333",
    fontWeight: "500",
  },
  hostBadge: {
    fontSize: 12,
    color: "#6C47FF",
    fontWeight: "700",
    backgroundColor: "#ede9fe",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
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
  homeLink: {
    marginTop: 32,
    paddingVertical: 8,
  },
  homeLinkText: {
    color: "#999",
    fontSize: 16,
  },
});
