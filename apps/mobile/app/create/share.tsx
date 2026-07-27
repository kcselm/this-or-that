import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
  Share,
  FlatList,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRouter, useLocalSearchParams } from "expo-router";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { getVoterId } from "../../lib/storage";
import { saveActiveRoom } from "../../lib/storage";
import {
  startVoting,
  closeRoom,
  getParticipants,
  getRoom,
  addItem,
  deleteItem,
  updateRoomSettings,
  type Participant,
  type RoomItem,
} from "../../lib/api";
import { clearActiveRoom } from "../../lib/storage";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";

export default function ShareScreen() {
  const router = useRouter();
  const { code, name, mode: modeParam } = useLocalSearchParams<{ code: string; name: string; mode?: string }>();
  const [mode, setMode] = useState<"vote" | "rank" | "bracket" | "mlt" | "tier">(
    modeParam === "rank" ? "rank" : modeParam === "bracket" ? "bracket" : modeParam === "mlt" ? "mlt" : modeParam === "tier" ? "tier" : "vote"
  );
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [items, setItems] = useState<RoomItem[]>([]);
  const [currentItem, setCurrentItem] = useState("");
  const [allowSuggestions, setAllowSuggestions] = useState(false);
  const [topic, setTopic] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const voterId = await getVoterId();
        const room = await getRoom(code, voterId);
        setItems(room.items);
        if (room.mode) setMode(room.mode);
        setAllowSuggestions(room.allowSuggestions);
        if (room.topic) setTopic(room.topic);

        const data = await getParticipants(code);
        setParticipants(data.participants);
      } catch {}
    };

    poll();
    intervalRef.current = setInterval(poll, 3000);
    return () => clearInterval(intervalRef.current);
  }, [code]);

  // Save active room on mount
  useEffect(() => {
    if (topic) {
      saveActiveRoom({ code, topic, name, isCreator: true });
    }
  }, [code, topic, name]);

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

  const handleAddItem = async () => {
    const trimmed = currentItem.trim();
    if (!trimmed) return;
    if (items.length >= maxItems) return Alert.alert("Limit", `Maximum ${maxItems} items`);
    if (items.some((i) => i.title.toLowerCase() === trimmed.toLowerCase())) {
      return Alert.alert("Duplicate", "That item already exists");
    }

    try {
      const voterId = await getVoterId();
      await addItem(code, { item: trimmed, creatorVoterId: voterId });
      setCurrentItem("");
      // Immediately refresh
      const room = await getRoom(code, voterId);
      setItems(room.items);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    try {
      const voterId = await getVoterId();
      await deleteItem(code, itemId, voterId);
      const room = await getRoom(code, voterId);
      setItems(room.items);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  const handleToggleSuggestions = async (value: boolean) => {
    setAllowSuggestions(value);
    try {
      const voterId = await getVoterId();
      await updateRoomSettings(code, {
        creatorVoterId: voterId,
        allowSuggestions: value,
      });
    } catch (e: any) {
      setAllowSuggestions(!value);
      Alert.alert("Error", e.message);
    }
  };

  const handleClose = async () => {
    const confirmed =
      Platform.OS === "web"
        ? window.confirm("This will close the room for everyone. Are you sure?")
        : await new Promise<boolean>((resolve) =>
            Alert.alert(
              "Close Room",
              "This will close the room for everyone. Are you sure?",
              [
                { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                { text: "Close Room", style: "destructive", onPress: () => resolve(true) },
              ]
            )
          );

    if (!confirmed) return;

    try {
      const voterId = await getVoterId();
      await closeRoom(code, voterId);
      await clearActiveRoom();
      clearInterval(intervalRef.current);
      router.replace("/");
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  const handleStart = async () => {
    if (!canStart) {
      return Alert.alert(
        "Not ready",
        mode === "rank"
          ? "Blind rank rooms need exactly 5 items"
          : mode === "bracket"
          ? "Bracket rooms need between 4 and 16 items"
          : mode === "mlt"
          ? "Most Likely To needs at least 3 prompts and 3 participants"
          : mode === "tier"
          ? "Tier list rooms need between 3 and 12 items"
          : "Add at least 2 items to start voting"
      );
    }
    setLoading(true);
    try {
      const voterId = await getVoterId();
      await startVoting(code, voterId);
      router.replace({
        pathname:
          mode === "rank" ? "/room/[code]/rank" :
          mode === "bracket" ? "/room/[code]/bracket" :
          mode === "mlt" ? "/room/[code]/mlt" :
          mode === "tier" ? "/room/[code]/tier" :
          "/room/[code]/swipe",
        params: { code, name, isCreator: "true" },
      });
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const renderItem = ({ item, index }: { item: RoomItem; index: number }) => (
    <View style={styles.itemRow}>
      <View style={styles.itemNumber}>
        <Text style={styles.itemNumberText}>{index + 1}</Text>
      </View>
      <View style={styles.itemInfo}>
        <Text style={styles.itemText} numberOfLines={1}>
          {item.title}
        </Text>
        {item.addedBy && (
          <Text style={styles.addedByText}>Added by {item.addedBy.name}</Text>
        )}
      </View>
      <Pressable
        onPress={() => handleDeleteItem(item.id)}
        hitSlop={8}
        style={({ pressed }) => [
          styles.removeButton,
          pressed && styles.removeButtonPressed,
        ]}
      >
        <Text style={styles.removeText}>x</Text>
      </Pressable>
    </View>
  );

  const maxItems =
    mode === "rank" ? 5 :
    mode === "bracket" ? 16 :
    mode === "tier" ? 12 : 15;
  const canStart =
    mode === "rank" ? items.length === 5 :
    mode === "bracket" ? items.length >= 4 && items.length <= 16 :
    mode === "mlt" ? items.length >= 3 && items.length <= 15 && participants.length >= 3 :
    mode === "tier" ? items.length >= 3 && items.length <= 12 :
    items.length >= 2;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Room code card */}
      <Animated.View entering={FadeInDown.duration(500).delay(100).springify()} style={styles.codeCard}>
        <Text style={styles.codeLabel}>ROOM CODE</Text>
        <Text style={styles.code}>{code}</Text>
        <View style={styles.codeActions}>
          <Pressable
            style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
            onPress={handleCopy}
          >
            <Text style={styles.actionText}>
              {copied ? "Copied!" : "Copy"}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionButton, styles.shareButton, pressed && styles.shareButtonPressed]}
            onPress={handleShare}
          >
            <Text style={[styles.actionText, styles.shareText]}>Share</Text>
          </Pressable>
        </View>
      </Animated.View>

      {/* Suggestions toggle */}
      {mode === "vote" && (
        <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.toggleRow}>
          <View style={styles.toggleLabel}>
            <Text style={styles.toggleText}>Let others add items</Text>
          </View>
          <Switch
            value={allowSuggestions}
            onValueChange={handleToggleSuggestions}
            trackColor={{ false: colors.sand, true: colors.tealLight }}
            thumbColor={allowSuggestions ? colors.teal : colors.mist}
          />
        </Animated.View>
      )}

      {/* Items list */}
      <View style={styles.itemsSection}>
        <View style={styles.itemsHeader}>
          <Text style={styles.sectionHeading}>OPTIONS</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{items.length}/{maxItems}</Text>
          </View>
        </View>

        {/* Add item input */}
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Type an option..."
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
          renderItem={renderItem}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No items yet — add some above</Text>
            </View>
          }
        />
      </View>

      {/* Participants */}
      {participants.length > 0 && (
        <View style={styles.participantSection}>
          <Text style={styles.sectionHeading}>
            IN THE ROOM ({participants.length})
          </Text>
          <View style={styles.participantRow}>
            {participants.map((p) => (
              <View key={p.voterId} style={styles.participantChip}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {p.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.participantName} numberOfLines={1}>{p.name}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Bottom actions */}
      <View style={styles.bottomSection}>
        {mode === "mlt" && participants.length < 3 && (
          <Text style={styles.hint}>
            {participants.length} of 3 joined — share the code to fill the room.
          </Text>
        )}
        <Pressable
          style={({ pressed }) => [
            styles.startButton,
            (loading || !canStart) && styles.buttonDisabled,
            pressed && !loading && canStart && styles.startButtonPressed,
          ]}
          onPress={handleStart}
          disabled={loading || !canStart}
        >
          <Text style={styles.startButtonText}>
            {loading
              ? "Starting..."
              : mode === "rank"
              ? "Start Ranking"
              : mode === "bracket"
              ? "Start Tournament"
              : mode === "mlt"
              ? "Start Game"
              : mode === "tier"
              ? "Start Tier List"
              : "Start Voting"}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.closeLink, pressed && { opacity: 0.6 }]}
          onPress={handleClose}
        >
          <Text style={styles.closeLinkText}>Close Room</Text>
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
  codeCard: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.xl,
    padding: spacing.lg,
    alignItems: "center",
    marginBottom: spacing.md,
    ...shadows.card,
  },
  codeLabel: {
    ...typography.tiny,
    color: colors.mist,
    marginBottom: spacing.xs,
  },
  code: {
    fontSize: 36,
    fontWeight: "800",
    color: colors.coral,
    letterSpacing: 6,
    marginBottom: spacing.md,
  },
  codeActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionButton: {
    backgroundColor: colors.coralLight,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  actionButtonPressed: {
    backgroundColor: colors.noBg,
    transform: [{ scale: 0.95 }],
  },
  actionText: {
    ...typography.bodyBold,
    color: colors.coral,
  },
  shareButton: {
    backgroundColor: colors.tealLight,
  },
  shareButtonPressed: {
    backgroundColor: colors.yesBg,
    transform: [{ scale: 0.95 }],
  },
  shareText: {
    color: colors.teal,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.warmWhite,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  toggleLabel: {
    flex: 1,
    marginRight: spacing.md,
  },
  toggleText: {
    ...typography.bodyBold,
    color: colors.charcoal,
  },
  itemsSection: {
    flex: 1,
    minHeight: 80,
  },
  itemsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  sectionHeading: {
    ...typography.tiny,
    color: colors.mist,
  },
  countBadge: {
    backgroundColor: colors.coralLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  countText: {
    ...typography.caption,
    color: colors.coral,
    fontWeight: "700",
  },
  list: {
    flex: 1,
  },
  listContent: {
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
  removeButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.coralLight,
    alignItems: "center",
    justifyContent: "center",
  },
  removeButtonPressed: {
    backgroundColor: colors.noBg,
  },
  removeText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.coral,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: colors.mist,
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
  participantRow: {
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
  bottomSection: {
    marginTop: "auto",
  },
  hint: {
    ...typography.body,
    color: colors.slate,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  startButton: {
    backgroundColor: colors.coral,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    ...shadows.button,
  },
  buttonDisabled: {
    opacity: 0.5,
    shadowOpacity: 0,
  },
  startButtonPressed: {
    backgroundColor: colors.coralDark,
    transform: [{ scale: 0.98 }],
  },
  startButtonText: {
    color: colors.warmWhite,
    fontSize: 18,
    fontWeight: "700",
  },
  closeLink: {
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  closeLinkText: {
    ...typography.body,
    color: colors.mist,
  },
});
