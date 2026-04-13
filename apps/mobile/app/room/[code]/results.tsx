import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { getResults, type ResultsResponse } from "../../../lib/api";

type RevealedResults = Extract<ResultsResponse, { revealed: true }>;

export default function ResultsScreen() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  const [data, setData] = useState<RevealedResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadResults = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getResults(code);
      if (res.revealed) {
        setData(res);
      } else {
        setError("Results aren't ready yet. Waiting for everyone to finish.");
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadResults();
  }, [code]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6C47FF" />
        <Text style={styles.loadingText}>Loading results...</Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? "Results not available yet"}</Text>
        <Pressable style={styles.retryButton} onPress={loadResults}>
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
        <Pressable style={styles.homeLinkButton} onPress={() => router.replace("/")}>
          <Text style={styles.homeLinkText}>Back to Home</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.topic}>{data.topic}</Text>
      <Text style={styles.meta}>{data.totalVoters} voters</Text>

      <FlatList
        data={data.results}
        keyExtractor={(item) => item.itemId}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <View style={styles.resultRow}>
            <View style={styles.rankBadge}>
              <Text style={styles.rankText}>#{index + 1}</Text>
            </View>
            <View style={styles.resultInfo}>
              <Text style={styles.resultTitle}>{item.title}</Text>
              <View style={styles.barContainer}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${item.yesPercentage}%`,
                      backgroundColor:
                        item.yesPercentage >= 70
                          ? "#48bb78"
                          : item.yesPercentage >= 40
                          ? "#ecc94b"
                          : "#e53e3e",
                    },
                  ]}
                />
              </View>
              <Text style={styles.resultMeta}>
                {item.yesPercentage}% yes ({item.yesCount} yes, {item.noCount} no)
              </Text>
            </View>
          </View>
        )}
      />

      <Pressable style={styles.homeButton} onPress={() => router.replace("/")}>
        <Text style={styles.homeButtonText}>Back to Home</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 24,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  topic: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    textAlign: "center",
  },
  meta: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 24,
  },
  list: {
    gap: 12,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f9f9f9",
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  rankBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#6C47FF",
    justifyContent: "center",
    alignItems: "center",
  },
  rankText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14,
  },
  resultInfo: {
    flex: 1,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 6,
  },
  barContainer: {
    height: 8,
    backgroundColor: "#eee",
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 4,
  },
  barFill: {
    height: "100%",
    borderRadius: 4,
  },
  resultMeta: {
    fontSize: 12,
    color: "#999",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#999",
  },
  errorText: {
    fontSize: 16,
    color: "#e53e3e",
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: "#6C47FF",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  retryText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  homeLinkButton: {
    paddingVertical: 8,
  },
  homeLinkText: {
    color: "#6C47FF",
    fontSize: 16,
  },
  homeButton: {
    backgroundColor: "#6C47FF",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 16,
  },
  homeButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
});
