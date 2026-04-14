import { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Alert, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRouter, useLocalSearchParams } from "expo-router";
import { getVoterId } from "../../lib/storage";
import { startVoting, getParticipants, type Participant } from "../../lib/api";

export default function ShareScreen() {
  const router = useRouter();
  const { code, name } = useLocalSearchParams<{ code: string; name: string }>();
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    const poll = async () => {
      try {
        const data = await getParticipants(code);
        setParticipants(data.participants);
      } catch {}
    };

    poll();
    intervalRef.current = setInterval(poll, 3000);
    return () => clearInterval(intervalRef.current);
  }, [code]);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Join my This or That room! Code: ${code}`,
      });
    } catch {}
  };

  const handleStart = async () => {
    setLoading(true);
    try {
      const voterId = await getVoterId();
      await startVoting(code, voterId);
      router.replace({
        pathname: `/room/${code}/swipe`,
        params: { name, isCreator: "true" },
      });
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Share this code</Text>
      <Text style={styles.subheading}>
        Send it to your friends so they can join
      </Text>

      <View style={styles.codeBox}>
        <Text style={styles.code}>{code}</Text>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.actionButton} onPress={handleCopy}>
          <Text style={styles.actionText}>
            {copied ? "Copied!" : "Copy Code"}
          </Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={handleShare}>
          <Text style={styles.actionText}>Share</Text>
        </Pressable>
      </View>

      {participants.length > 0 && (
        <View style={styles.participantSection}>
          <Text style={styles.participantHeading}>
            In the room ({participants.length})
          </Text>
          {participants.map((p) => (
            <View key={p.voterId} style={styles.participantRow}>
              <Text style={styles.participantName}>{p.name}</Text>
              {p.isCreator && <Text style={styles.hostBadge}>You</Text>}
            </View>
          ))}
        </View>
      )}

      <Pressable
        style={[styles.startButton, loading && styles.buttonDisabled]}
        onPress={handleStart}
        disabled={loading}
      >
        <Text style={styles.startButtonText}>
          {loading ? "Starting..." : "Start Voting"}
        </Text>
      </Pressable>

      <Text style={styles.hint}>
        You can start voting once everyone has joined.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  heading: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
  subheading: {
    fontSize: 16,
    color: "#666",
    marginTop: 8,
    marginBottom: 32,
  },
  codeBox: {
    backgroundColor: "#f5f3ff",
    paddingHorizontal: 32,
    paddingVertical: 20,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#6C47FF",
    marginBottom: 24,
  },
  code: {
    fontSize: 40,
    fontWeight: "bold",
    color: "#6C47FF",
    letterSpacing: 8,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 40,
  },
  actionButton: {
    backgroundColor: "#f0ecff",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  actionText: {
    color: "#6C47FF",
    fontSize: 16,
    fontWeight: "600",
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
  participantRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f5f3ff",
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
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
  startButton: {
    backgroundColor: "#6C47FF",
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
    width: "100%",
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  startButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  hint: {
    color: "#999",
    fontSize: 14,
    marginTop: 16,
    textAlign: "center",
  },
});
