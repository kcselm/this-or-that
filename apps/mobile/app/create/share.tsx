import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { MODE_RULES } from "@tot/shared";
import {
  getVoterId,
  getSavedLists,
  createSavedList,
  saveActiveRoom,
  clearActiveRoom,
} from "../../lib/storage";
import { planImport, describeSkipped, type SavedList } from "../../lib/saved-lists";
import {
  addItems,
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
import { parseMode, playScreen, startBlocker, START_LABELS } from "../../lib/modes";
import { usePolling } from "../../lib/usePolling";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";
import { showAlert } from "../../lib/alert";
import RoomCodeCard from "../../components/share/RoomCodeCard";
import ItemEditor from "../../components/share/ItemEditor";
import ParticipantChips from "../../components/share/ParticipantChips";

// The host's lobby: share the code, edit the items, watch people join, start.
export default function ShareScreen() {
  const router = useRouter();
  const { code, name, mode: modeParam, listId } = useLocalSearchParams<{
    code: string;
    name: string;
    mode?: string;
    listId?: string;
  }>();
  const [mode, setMode] = useState(parseMode(modeParam));
  const [loading, setLoading] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [items, setItems] = useState<RoomItem[]>([]);
  const [allowSuggestions, setAllowSuggestions] = useState(false);
  const [topic, setTopic] = useState("");
  const [savedLists, setSavedLists] = useState<SavedList[]>([]);
  const [importing, setImporting] = useState(false);
  const autoImported = useRef(false);

  const { maxItems, maxItemLength } = MODE_RULES[mode];
  const blocker = startBlocker(mode, items.length, participants.length);

  usePolling(async () => {
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
  }, 5000);

  // Save active room on mount
  useEffect(() => {
    if (topic) {
      saveActiveRoom({ code, topic, name, isCreator: true });
    }
  }, [code, topic, name]);

  const importList = async (list: SavedList) => {
    if (importing) return;
    setImporting(true);
    try {
      const voterId = await getVoterId();
      // Read the room fresh so the plan sees items added since the last poll.
      const room = await getRoom(code, voterId);
      const rules = MODE_RULES[room.mode];
      const plan = planImport(
        list.items,
        room.items.map((i) => i.title),
        rules.maxItems,
        rules.maxItemLength
      );
      if (plan.toAdd.length > 0) {
        await addItems(code, { items: plan.toAdd, creatorVoterId: voterId });
        setItems((await getRoom(code, voterId)).items);
      }
      const skipped = describeSkipped(plan.duplicates, plan.overflow, rules.maxItems);
      if (plan.toAdd.length === 0) {
        showAlert("Nothing added", skipped ?? "That list is empty.");
      } else if (skipped) {
        showAlert(`Added ${plan.toAdd.length} from "${list.name.trim() || "Untitled list"}"`, skipped);
      }
    } catch (e: any) {
      showAlert("Error", e.message);
    } finally {
      setImporting(false);
    }
  };

  // Load saved lists for the picker, and auto-load the one the host chose
  // when they started from My Lists.
  useEffect(() => {
    getSavedLists().then((lists) => {
      setSavedLists(lists);
      if (listId && !autoImported.current) {
        autoImported.current = true;
        const list = lists.find((l) => l.id === listId);
        if (list) importList(list);
      }
    });
  }, []);

  const handleSaveAsList = async () => {
    const list = await createSavedList(
      topic,
      items.map((i) => i.title)
    );
    setSavedLists((prev) => [list, ...prev]);
    showAlert("Saved", `"${topic || "Untitled list"}" is in My Lists for next time.`);
  };

  const handleAddItem = async (title: string): Promise<boolean> => {
    const trimmed = title.trim();
    if (!trimmed) return false;
    if (items.length >= maxItems) {
      showAlert("Limit", `Maximum ${maxItems} items`);
      return false;
    }
    if (items.some((i) => i.title.toLowerCase() === trimmed.toLowerCase())) {
      showAlert("Duplicate", "That item already exists");
      return false;
    }

    try {
      const voterId = await getVoterId();
      await addItem(code, { item: trimmed, creatorVoterId: voterId });
      // Immediately refresh
      const room = await getRoom(code, voterId);
      setItems(room.items);
      return true;
    } catch (e: any) {
      showAlert("Error", e.message);
      return false;
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    try {
      const voterId = await getVoterId();
      await deleteItem(code, itemId, voterId);
      const room = await getRoom(code, voterId);
      setItems(room.items);
    } catch (e: any) {
      showAlert("Error", e.message);
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
      showAlert("Error", e.message);
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
      router.replace("/");
    } catch (e: any) {
      showAlert("Error", e.message);
    }
  };

  const handleStart = async () => {
    if (blocker) return;
    setLoading(true);
    try {
      const voterId = await getVoterId();
      await startVoting(code, voterId);
      router.replace({
        pathname: playScreen(mode),
        params: { code, name, isCreator: "true" },
      });
    } catch (e: any) {
      showAlert("Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const startDisabled = loading || !!blocker;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <RoomCodeCard code={code} />

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
            accessibilityLabel="Let others add items"
          />
        </Animated.View>
      )}

      <ItemEditor
        items={items}
        maxItems={maxItems}
        maxItemLength={maxItemLength}
        onAdd={handleAddItem}
        onDelete={handleDeleteItem}
        savedLists={savedLists}
        importing={importing}
        onImport={importList}
        onSaveAsList={handleSaveAsList}
      />

      <ParticipantChips participants={participants} />

      {/* Bottom actions */}
      <View style={styles.bottomSection}>
        {/* Say why Start is disabled rather than leaving the host guessing. */}
        {blocker && <Text style={styles.hint}>{blocker}</Text>}
        <Pressable
          style={({ pressed }) => [
            styles.startButton,
            startDisabled && styles.buttonDisabled,
            pressed && !startDisabled && styles.startButtonPressed,
          ]}
          onPress={handleStart}
          disabled={startDisabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: startDisabled }}
        >
          <Text style={styles.startButtonText}>{loading ? "Starting..." : START_LABELS[mode]}</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.closeLink, pressed && { opacity: 0.6 }]}
          onPress={handleClose}
          accessibilityRole="button"
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
