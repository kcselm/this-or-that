import { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import Animated, {
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import {
  getRoom,
  getParticipants,
  addItem,
  ApiError,
  type Participant,
  type RoomItem,
} from "../../../lib/api";
import { getVoterId, saveActiveRoom } from "../../../lib/storage";
import { MODE_RULES } from "@tot/shared";
import { roomScreen, type Mode } from "../../../lib/modes";
import { usePolling } from "../../../lib/usePolling";
import { showAlert } from "../../../lib/alert";
import { colors, spacing, radius, typography, shadows } from "../../../lib/theme";

function PulsingDot() {
  const opacity = useSharedValue(1);

  opacity.value = withRepeat(withTiming(0.3, { duration: 1000 }), -1, true);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return <Animated.View style={[dotStyles.dot, style]} />;
}

const dotStyles = StyleSheet.create({
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.coral,
  },
});

export default function LobbyScreen() {
  const router = useRouter();
  const { code, name } = useLocalSearchParams<{ code: string; name: string }>();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [topic, setTopic] = useState<string | null>(null);
  const [items, setItems] = useState<RoomItem[]>([]);
  const [mode, setMode] = useState<Mode>("vote");
  const [allowSuggestions, setAllowSuggestions] = useState(false);
  const [currentItem, setCurrentItem] = useState("");
  const [roundNumber, setRoundNumber] = useState(1);
  const inputRef = useRef<TextInput>(null);

  usePolling(async (stop) => {
    try {
      const voterId = await getVoterId();
      const room = await getRoom(code, voterId);
      if (room.topic) {
        setTopic(room.topic);
        saveActiveRoom({ code, topic: room.topic, name });
      }
      setAllowSuggestions(room.allowSuggestions);
      setMode(room.mode);
      setItems(room.items);
      if (room.roundNumber) setRoundNumber(room.roundNumber);

      if (room.status === "closed") {
        stop();
        showAlert("Room Closed", "The host closed this room.", () =>
          router.replace("/")
        );
        return;
      } else if (room.status !== "open") {
        stop();
        router.replace({
          pathname: roomScreen(room.status, room.mode, false) ?? "/",
          params: { code, name },
        });
        return;
      }

      const data = await getParticipants(code);
      setParticipants(data.participants);
    } catch (e) {
      if (e instanceof ApiError && e.code === "ROOM_NOT_FOUND") {
        stop();
        showAlert("Room Expired", "This room no longer exists.", () =>
          router.replace("/")
        );
      }
    }
  }, 4000);

  const handleAddItem = async () => {
    const trimmed = currentItem.trim();
    if (!trimmed) return;
    const { maxItems } = MODE_RULES[mode];
    if (items.length >= maxItems) return showAlert("Limit", `Maximum ${maxItems} items`);
    if (items.some((i) => i.title.toLowerCase() === trimmed.toLowerCase())) {
      return showAlert("Duplicate", "That item already exists");
    }

    try {
      const voterId = await getVoterId();
      await addItem(code, { item: trimmed, voterId, voterName: name });
      setCurrentItem("");
      // Refresh items
      const room = await getRoom(code, voterId);
      setItems(room.items);
    } catch (e: any) {
      showAlert("Error", e.message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.topSection}>
        <Animated.View entering={FadeInUp.duration(400)} style={styles.statusRow}>
          <PulsingDot />
          <Text style={styles.statusText}>Waiting for host</Text>
        </Animated.View>
        {roundNumber > 1 && (
          <Text style={styles.roundBadge}>ROUND {roundNumber}</Text>
        )}
        {topic && (
          <Animated.Text entering={FadeInUp.duration(400).delay(100)} style={styles.topicText}>
            {topic}
          </Animated.Text>
        )}
        <Animated.Text entering={FadeInUp.duration(400).delay(150)} style={styles.subheading}>
          {allowSuggestions
            ? "Add items while you wait!"
            : "The host is still setting up. Voting will start soon..."}
        </Animated.Text>
      </View>

      {/* Collaborative items section */}
      {allowSuggestions && (
        <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.itemsSection}>
          <View style={styles.itemsHeader}>
            <Text style={styles.sectionHeading}>OPTIONS ({items.length}/15)</Text>
          </View>

          <View style={styles.inputRow}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="Suggest an option..."
              placeholderTextColor={colors.mist}
              value={currentItem}
              onChangeText={setCurrentItem}
              onSubmitEditing={handleAddItem}
              blurOnSubmit={false}
              returnKeyType="done"
              maxLength={100}
            />
            <Pressable
              style={({ pressed }) => [
                styles.addButton,
                pressed && styles.addButtonPressed,
              ]}
              onPress={() => {
                handleAddItem();
                inputRef.current?.focus();
              }}
            >
              <Text style={styles.addButtonText}>+</Text>
            </Pressable>
          </View>

          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            style={styles.itemList}
            contentContainerStyle={styles.itemListContent}
            renderItem={({ item, index }) => (
              <View style={styles.itemRow}>
                <View style={styles.itemNumber}>
                  <Text style={styles.itemNumberText}>{index + 1}</Text>
                </View>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemText} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {item.addedBy && (
                    <Text style={styles.addedByText}>
                      {item.addedBy.name}
                    </Text>
                  )}
                </View>
              </View>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No items yet — be the first to add one!</Text>
            }
          />
        </Animated.View>
      )}

      {participants.length > 0 && (
        <Animated.View entering={FadeInDown.duration(400).delay(300)} style={styles.participantSection}>
          <Text style={styles.sectionHeading}>
            IN THE ROOM ({participants.length})
          </Text>
          <View style={styles.participantList}>
            {participants.map((p) => (
              <View key={p.participantId} style={styles.participantChip}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {p.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.participantName} numberOfLines={1}>{p.name}</Text>
                {p.isCreator && (
                  <View style={styles.hostBadge}>
                    <Text style={styles.hostBadgeText}>HOST</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </Animated.View>
      )}

      <View style={styles.bottomSection}>
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>ROOM CODE</Text>
          <Text style={styles.codeText}>{code}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.leaveButton, pressed && styles.leaveButtonPressed]}
          onPress={() => router.replace("/")}
        >
          <Text style={styles.leaveText}>Leave Room</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xl,
    backgroundColor: colors.cream,
  },
  topSection: {
    alignItems: "center",
    marginTop: spacing.xl,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  statusText: {
    ...typography.h2,
    color: colors.charcoal,
  },
  topicText: {
    ...typography.h1,
    color: colors.coral,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  subheading: {
    ...typography.body,
    color: colors.slate,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  roundBadge: {
    ...typography.tiny,
    color: colors.amber,
    letterSpacing: 2,
    marginBottom: spacing.xs,
  },
  itemsSection: {
    flex: 1,
    minHeight: 100,
  },
  itemsHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  sectionHeading: {
    ...typography.tiny,
    color: colors.mist,
  },
  itemList: {
    flex: 1,
  },
  itemListContent: {
    gap: spacing.sm,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.warmWhite,
    padding: spacing.md,
    borderRadius: radius.md,
    gap: spacing.md,
    ...shadows.soft,
  },
  itemNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.sandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  itemNumberText: {
    ...typography.caption,
    color: colors.slate,
    fontWeight: "700",
  },
  itemInfo: {
    flex: 1,
  },
  itemText: {
    ...typography.body,
    color: colors.charcoal,
  },
  addedByText: {
    ...typography.caption,
    color: colors.mist,
    marginTop: 1,
  },
  emptyText: {
    ...typography.body,
    color: colors.mist,
    textAlign: "center",
    paddingVertical: spacing.lg,
  },
  inputRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  input: {
    flex: 1,
    borderWidth: 2,
    borderColor: colors.sand,
    borderRadius: radius.md,
    padding: 12,
    fontSize: 16,
    backgroundColor: colors.warmWhite,
    color: colors.charcoal,
  },
  addButton: {
    backgroundColor: colors.teal,
    width: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonPressed: {
    backgroundColor: colors.tealDark,
    transform: [{ scale: 0.95 }],
  },
  addButtonText: {
    color: colors.warmWhite,
    fontSize: 24,
    fontWeight: "700",
  },
  participantSection: {
    marginBottom: spacing.md,
  },
  participantList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  participantChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.warmWhite,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    gap: spacing.xs,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.coralLight,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.coral,
  },
  participantName: {
    ...typography.caption,
    color: colors.charcoal,
    maxWidth: 80,
  },
  hostBadge: {
    backgroundColor: colors.amberLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  hostBadgeText: {
    ...typography.tiny,
    color: colors.amber,
    fontSize: 9,
  },
  bottomSection: {
    alignItems: "center",
    marginTop: "auto",
  },
  codeCard: {
    backgroundColor: colors.warmWhite,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    alignItems: "center",
    ...shadows.soft,
  },
  codeLabel: {
    ...typography.tiny,
    color: colors.mist,
    marginBottom: spacing.xs,
  },
  codeText: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.coral,
    letterSpacing: 4,
  },
  leaveButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  leaveButtonPressed: {
    opacity: 0.6,
  },
  leaveText: {
    ...typography.body,
    color: colors.mist,
  },
});
