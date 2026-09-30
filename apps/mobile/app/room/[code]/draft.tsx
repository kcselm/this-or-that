import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { MODE_RULES } from "@tot/shared";
import {
  getDraft,
  getRoom,
  submitPick,
  ApiError,
  type DraftPick,
  type DraftResponse,
  type DraftSeat,
} from "../../../lib/api";
import { getVoterId } from "../../../lib/storage";
import { getPlayerColor } from "../../../lib/player-colors";
import { roomScreen } from "../../../lib/modes";
import { usePolling } from "../../../lib/usePolling";
import { showAlert } from "../../../lib/alert";
import { colors, spacing, radius, typography, shadows } from "../../../lib/theme";
import PulsingDot from "../../../components/PulsingDot";

const POLL_MS = 2500;
const { maxItemLength } = MODE_RULES.draft;

// The draft board. Everyone stays here for the whole draft, watching picks
// land between their own turns; it routes to the results once the room reveals.
export default function DraftScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code, name } = useLocalSearchParams<{ code: string; name?: string }>();

  const [topic, setTopic] = useState("");
  const [board, setBoard] = useState<DraftResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entry, setEntry] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set once we've navigated away, so a poll in flight can't route twice.
  const left = useRef(false);

  // /draft doesn't carry the topic; it never changes, so fetch it once.
  useEffect(() => {
    getVoterId()
      .then((voterId) => getRoom(code, voterId))
      .then((room) => setTopic(room.topic))
      .catch(() => {});
  }, [code]);

  const goToResults = () => {
    left.current = true;
    router.replace({ pathname: "/room/[code]/results", params: { code, name: name ?? "" } });
  };

  const goHome = (title: string, message: string) => {
    left.current = true;
    showAlert(title, message, () => router.replace("/"));
  };

  const load = async () => {
    if (left.current) return;
    try {
      const voterId = await getVoterId();
      const data = await getDraft(code, voterId);
      if (left.current) return;
      if (data.status === "revealed") return goToResults();
      if (data.status === "closed") return goHome("Room Closed", "The host closed this room.");
      setBoard(data);
      setLoadError(null);
    } catch (e) {
      if (left.current) return;
      if (e instanceof ApiError && e.code === "ROOM_NOT_FOUND") {
        return goHome("Room Expired", "This room no longer exists.");
      }
      // /draft refuses rooms that aren't drafting; the room itself says where to go.
      if (e instanceof ApiError && e.code === "INVALID_STATUS") {
        const room = await getRoom(code).catch(() => null);
        if (room && room.status !== "voting" && !left.current) {
          if (room.status === "closed") return goHome("Room Closed", "The host closed this room.");
          left.current = true;
          router.replace({
            pathname: roomScreen(room.status, room.mode, false) ?? "/",
            params: { code, name: name ?? "" },
          });
          return;
        }
      }
      // Keep showing the last board through a blip; only an empty screen needs the error.
      setLoadError(e instanceof ApiError ? e.message : "Couldn't load the draft.");
    }
  };

  usePolling(async (stop) => {
    await load();
    if (left.current) stop();
  }, POLL_MS);

  const handleSubmit = async () => {
    const title = entry.trim();
    if (!title || submitting || !board?.current?.isYou) return;
    setSubmitting(true);
    setPickError(null);
    try {
      const voterId = await getVoterId();
      const res = await submitPick(code, { voterId, voterName: name ?? "", title });
      setEntry("");
      if (res.isRevealed) return goToResults();
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === "NOT_YOUR_TURN") {
        // Someone else's pick landed first; the fresh board shows whose turn it is.
        await load();
      } else if (e instanceof ApiError && e.code === "DUPLICATE_PICK") {
        // Keep the text so they can tweak it rather than retype it.
        setPickError(e.message);
      } else {
        setPickError(e instanceof Error ? e.message : "Couldn't submit your pick.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!board) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        {loadError ? (
          <>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable
              style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
              onPress={load}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>Try Again</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator size="large" color={colors.coral} />
        )}
      </View>
    );
  }

  const { current, seats, picks, rounds, totalPicks } = board;
  const latestPickIndex = picks.length > 0 ? picks[picks.length - 1].pickIndex : -1;
  const canSubmit = !!entry.trim() && !submitting;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.column}>
          <View style={styles.header}>
            {!!topic && (
              <Text style={styles.topic} numberOfLines={2}>
                {topic}
              </Text>
            )}
            <Text style={styles.progress}>
              {current
                ? `Round ${current.round + 1} of ${rounds} · Pick ${current.pickIndex + 1} of ${totalPicks}`
                : `Draft complete · ${picks.length} of ${totalPicks} picks`}
            </Text>
          </View>

          <OrderStrip seats={seats} picks={picks} rounds={rounds} current={current} />

          {current?.isYou ? (
            <View style={styles.turnCard}>
              <Text style={styles.turnHeading}>You&apos;re on the clock</Text>
              <TextInput
                // Remount per pick so auto-focus fires each time it's your turn again.
                key={current.pickIndex}
                style={[styles.input, !!pickError && styles.inputError]}
                placeholder="Type your pick..."
                placeholderTextColor={colors.mist}
                value={entry}
                onChangeText={(text) => {
                  setEntry(text);
                  if (pickError) setPickError(null);
                }}
                onSubmitEditing={handleSubmit}
                maxLength={maxItemLength}
                autoFocus
                returnKeyType="done"
                editable={!submitting}
                accessibilityLabel="Your pick"
              />
              {pickError && (
                <Text style={styles.pickError} accessibilityLiveRegion="polite">
                  {pickError}
                </Text>
              )}
              <Pressable
                style={({ pressed }) => [
                  styles.draftButton,
                  !canSubmit && styles.buttonDisabled,
                  pressed && canSubmit && styles.buttonPressed,
                ]}
                onPress={handleSubmit}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSubmit, busy: submitting }}
              >
                <Text style={styles.buttonText}>{submitting ? "Drafting..." : "Draft it"}</Text>
              </Pressable>
            </View>
          ) : current ? (
            <View style={styles.waitingRow} accessibilityLiveRegion="polite">
              <PulsingDot />
              <Text style={styles.waitingText}>Waiting for {current.name}…</Text>
            </View>
          ) : (
            <View style={styles.waitingRow}>
              <ActivityIndicator color={colors.coral} />
              <Text style={styles.waitingText}>Revealing the lists…</Text>
            </View>
          )}

          <View style={styles.boards}>
            {seats.map((seat) => (
              <SeatBoard
                key={seat.participantId}
                seat={seat}
                picks={picks.filter((p) => p.seat === seat.seat)}
                rounds={rounds}
                onClockRound={current?.seat === seat.seat ? current.round : null}
                latestPickIndex={latestPickIndex}
              />
            ))}
          </View>

          <Pressable
            style={({ pressed }) => [styles.leaveButton, pressed && { opacity: 0.6 }]}
            onPress={() => {
              left.current = true;
              router.replace("/");
            }}
            accessibilityRole="button"
          >
            <Text style={styles.leaveText}>Leave Room</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Every seat in draft order: who's on the clock, who's done. */
function OrderStrip({
  seats,
  picks,
  rounds,
  current,
}: {
  seats: DraftSeat[];
  picks: DraftPick[];
  rounds: number;
  current: DraftResponse["current"];
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      style={styles.stripScroll}
    >
      {seats.map((seat) => {
        const color = getPlayerColor(seat.seat);
        const onClock = current?.seat === seat.seat;
        const done = picks.filter((p) => p.seat === seat.seat).length >= rounds;
        const label = seat.isYou ? `${seat.name} (You)` : seat.name;
        return (
          <View
            key={seat.participantId}
            style={[
              styles.chip,
              { backgroundColor: color.tint },
              onClock && [styles.chipOnClock, { borderColor: color.border }],
              done && styles.chipDone,
            ]}
            accessibilityLabel={`${seat.seat + 1}. ${label}${onClock ? ", on the clock" : ""}${
              done ? ", done" : ""
            }`}
          >
            <View style={[styles.chipSeat, { backgroundColor: color.base }]}>
              <Text style={[styles.chipSeatText, { color: color.textOnBase }]}>
                {seat.seat + 1}
              </Text>
            </View>
            <Text style={[styles.chipName, onClock && styles.chipNameOnClock]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

/** One player's list so far, one row per round, with empty slots still to fill. */
function SeatBoard({
  seat,
  picks,
  rounds,
  onClockRound,
  latestPickIndex,
}: {
  seat: DraftSeat;
  picks: DraftPick[];
  rounds: number;
  /** The round this seat is picking in right now, or null when it isn't their turn. */
  onClockRound: number | null;
  latestPickIndex: number;
}) {
  const color = getPlayerColor(seat.seat);
  return (
    <View style={[styles.boardCard, seat.isYou && { borderColor: color.border }]}>
      <View style={styles.boardHeader}>
        <View style={[styles.boardSwatch, { backgroundColor: color.base }]} />
        <Text style={styles.boardName} numberOfLines={1}>
          {seat.isYou ? `${seat.name} (You)` : seat.name}
        </Text>
        {seat.isCreator && (
          <View style={styles.hostBadge}>
            <Text style={styles.hostBadgeText}>HOST</Text>
          </View>
        )}
      </View>
      {Array.from({ length: rounds }, (_, round) => {
        const pick = picks.find((p) => p.round === round);
        if (pick) {
          // Keyed by pick so the slot remounts when it fills, and only the
          // newest pick on the whole board gets the entrance.
          return (
            <Animated.View
              key={`pick-${pick.pickIndex}`}
              entering={pick.pickIndex === latestPickIndex ? FadeInDown.duration(350) : undefined}
              style={styles.slot}
            >
              <Text style={[styles.slotNumber, { color: color.base }]}>{round + 1}</Text>
              <Text style={styles.slotTitle} numberOfLines={2}>
                {pick.title}
              </Text>
            </Animated.View>
          );
        }
        const onClock = onClockRound === round;
        return (
          <View key={`empty-${round}`} style={[styles.slot, styles.slotEmpty]}>
            <Text style={[styles.slotNumber, styles.slotNumberEmpty]}>{round + 1}</Text>
            <Text style={styles.slotPlaceholder}>{onClock ? "On the clock…" : "—"}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
  },
  // Desktop web: a phone-width column reads better than a full-width board.
  column: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  centered: {
    flex: 1,
    backgroundColor: colors.cream,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
    gap: spacing.lg,
  },
  header: {
    gap: 4,
    marginBottom: spacing.md,
  },
  topic: {
    ...typography.h2,
    color: colors.charcoal,
  },
  progress: {
    ...typography.bodyBold,
    color: colors.coral,
  },
  stripScroll: {
    flexGrow: 0,
    marginBottom: spacing.lg,
  },
  strip: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    alignItems: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingLeft: spacing.xs,
    paddingRight: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: "transparent",
  },
  chipOnClock: {
    paddingVertical: spacing.sm,
    transform: [{ scale: 1.05 }],
  },
  chipDone: {
    opacity: 0.45,
  },
  chipSeat: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  chipSeatText: {
    fontSize: 12,
    fontWeight: "700",
  },
  chipName: {
    ...typography.caption,
    color: colors.charcoal,
    maxWidth: 120,
  },
  chipNameOnClock: {
    fontWeight: "700",
  },
  turnCard: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.coral,
    marginBottom: spacing.lg,
    ...shadows.soft,
  },
  turnHeading: {
    ...typography.h3,
    color: colors.charcoal,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 2,
    borderColor: colors.sand,
    borderRadius: radius.md,
    padding: 12,
    fontSize: 16,
    backgroundColor: colors.cream,
    color: colors.charcoal,
  },
  inputError: {
    borderColor: colors.error,
  },
  pickError: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xs,
  },
  draftButton: {
    backgroundColor: colors.coral,
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: "center",
    marginTop: spacing.md,
    ...shadows.button,
  },
  buttonDisabled: {
    opacity: 0.5,
    shadowOpacity: 0,
  },
  buttonPressed: {
    backgroundColor: colors.coralDark,
    transform: [{ scale: 0.98 }],
  },
  buttonText: {
    color: colors.warmWhite,
    fontSize: 18,
    fontWeight: "700",
  },
  waitingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.warmWhite,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  waitingText: {
    ...typography.bodyBold,
    color: colors.charcoal,
    flexShrink: 1,
  },
  boards: {
    gap: spacing.md,
  },
  boardCard: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
    borderWidth: 2,
    borderColor: "transparent",
    ...shadows.soft,
  },
  boardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  boardSwatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  boardName: {
    ...typography.bodyBold,
    color: colors.charcoal,
    flex: 1,
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
  slot: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 6,
  },
  slotEmpty: {
    opacity: 0.7,
  },
  slotNumber: {
    ...typography.caption,
    fontWeight: "700",
    width: 20,
    textAlign: "right",
  },
  slotNumberEmpty: {
    color: colors.mist,
  },
  slotTitle: {
    ...typography.body,
    color: colors.charcoal,
    flex: 1,
  },
  slotPlaceholder: {
    ...typography.body,
    color: colors.mist,
    fontStyle: "italic",
    flex: 1,
  },
  errorText: {
    ...typography.body,
    color: colors.error,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: colors.coral,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  leaveButton: {
    alignSelf: "center",
    marginTop: spacing.xl,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  leaveText: {
    ...typography.body,
    color: colors.mist,
  },
});
