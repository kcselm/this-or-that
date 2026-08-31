import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { showAlert } from "../../../lib/alert";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import TierChip from "../../../components/TierChip";
import TierRow, { type ZoneRect } from "../../../components/TierRow";
import { getRoom, submitTierBoard, ApiError, type RoomItem } from "../../../lib/api";
import {
  getVoterId,
  saveTierDraft,
  getTierDraft,
  clearTierDraft,
} from "../../../lib/storage";
import { seededShuffle } from "../../../lib/shuffle";
import { TIERS, TIER_META, type TierZone } from "../../../lib/tiers";
import { colors, spacing, typography, radius } from "../../../lib/theme";

export default function TierScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code, name, isCreator } = useLocalSearchParams<{
    code: string;
    name: string;
    isCreator?: string;
  }>();

  const [topic, setTopic] = useState("");
  const [items, setItems] = useState<RoomItem[]>([]);
  const [voterId, setVoterId] = useState("");
  const [placement, setPlacement] = useState<Record<string, TierZone>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverZone, setHoverZone] = useState<TierZone | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [measureNonce, setMeasureNonce] = useState(0);

  const zoneRects = useRef<Record<string, ZoneRect>>({});

  const navigateToWaiting = () => {
    router.replace({
      pathname: "/room/[code]/waiting",
      params: { code, name, isCreator: isCreator ?? "false" },
    });
  };

  const loadInitial = async () => {
    setLoading(true);
    setError(null);
    try {
      const vId = await getVoterId();
      setVoterId(vId);
      const room = await getRoom(code, vId);
      if (room.mode !== "tier") {
        setError("This room isn't a tier list room.");
        setLoading(false);
        return;
      }
      setTopic(room.topic);
      setItems(room.items);

      // Already locked in? (myTiers holds every item) -> go wait.
      if (
        room.myTiers &&
        room.items.length > 0 &&
        Object.keys(room.myTiers).length >= room.items.length
      ) {
        navigateToWaiting();
        return;
      }

      // Restore a local draft if present; otherwise everything starts in the pool.
      const draft = await getTierDraft(code);
      const initial: Record<string, TierZone> = {};
      for (const it of room.items) {
        const d = draft?.[it.id];
        initial[it.id] =
          d === "S" || d === "A" || d === "B" || d === "C" || d === "D"
            ? d
            : "pool";
      }
      setPlacement(initial);
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the room.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Deterministic per-player pool order so the initial layout isn't biased.
  const orderedItems = useMemo(
    () => (voterId ? seededShuffle(items, voterId) : items),
    [items, voterId]
  );

  const persist = (next: Record<string, TierZone>) => {
    saveTierDraft(code, next);
  };

  const moveChip = (id: string, zone: TierZone) => {
    setPlacement((prev) => {
      const next = { ...prev, [id]: zone };
      persist(next);
      return next;
    });
  };

  const handleMeasure = (zone: TierZone, rect: ZoneRect) => {
    zoneRects.current[zone] = rect;
  };

  const findZoneAt = (x: number, y: number): TierZone | null => {
    const zones: TierZone[] = [...TIERS, "pool"];
    for (const zone of zones) {
      const r = zoneRects.current[zone];
      if (!r) continue;
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
        return zone;
      }
    }
    return null;
  };

  const handleDragMove = (_id: string, x: number, y: number) => {
    setHoverZone(findZoneAt(x, y));
  };

  const handleDragEnd = (id: string, x: number, y: number) => {
    setHoverZone(null);
    const zone = findZoneAt(x, y);
    if (zone) moveChip(id, zone);
  };

  const handleTapChip = (id: string) => {
    setSelectedId((cur) => (cur === id ? null : id));
  };

  const handleZonePress = (zone: TierZone) => {
    if (!selectedId) return;
    moveChip(selectedId, zone);
    setSelectedId(null);
  };

  const chipsIn = (zone: TierZone) =>
    orderedItems.filter((it) => (placement[it.id] ?? "pool") === zone);

  const placedCount = items.filter((it) => (placement[it.id] ?? "pool") !== "pool").length;
  const allPlaced = items.length > 0 && placedCount === items.length;

  const handleLockIn = async () => {
    if (!allPlaced || submitting) return;
    setSubmitting(true);
    try {
      const placements = items.map((it) => ({
        itemId: it.id,
        tier: placement[it.id] as "S" | "A" | "B" | "C" | "D",
      }));
      await submitTierBoard(code, { voterId, voterName: name, placements });
      await clearTierDraft(code);
      navigateToWaiting();
    } catch (e: any) {
      showAlert("Error", e instanceof ApiError ? e.message : "Couldn't lock in your board.");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.coral} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={loadInitial}>
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  const renderChip = (it: RoomItem) => (
    <TierChip
      key={it.id}
      id={it.id}
      title={it.title}
      badgeColor={colors.coral}
      selected={selectedId === it.id}
      onTap={handleTapChip}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    />
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.topic} numberOfLines={1}>{topic}</Text>
        <Text style={styles.progress}>{placedCount} of {items.length}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.boardScroll}
        showsVerticalScrollIndicator={false}
        onScrollEndDrag={() => setMeasureNonce((n) => n + 1)}
        onMomentumScrollEnd={() => setMeasureNonce((n) => n + 1)}
        scrollEventThrottle={16}
      >
        {TIERS.map((tier) => {
          const meta = TIER_META[tier];
          return (
            <TierRow
              key={tier}
              zone={tier}
              labelText={meta.label}
              labelColor={meta.badge}
              labelTextColor={meta.text}
              rowBg={meta.rowBg}
              highlighted={hoverZone === tier}
              selectable={!!selectedId}
              onPress={handleZonePress}
              onMeasure={handleMeasure}
              measureNonce={measureNonce}
            >
              {chipsIn(tier).map(renderChip)}
            </TierRow>
          );
        })}

        <Text style={styles.poolLabel}>UNPLACED</Text>
        <TierRow
          zone="pool"
          labelText="•"
          labelColor={colors.sand}
          labelTextColor={colors.slate}
          rowBg={colors.sandLight}
          highlighted={hoverZone === "pool"}
          selectable={!!selectedId}
          onPress={handleZonePress}
          onMeasure={handleMeasure}
          measureNonce={measureNonce}
        >
          {chipsIn("pool").map(renderChip)}
        </TierRow>
      </ScrollView>

      <View style={styles.footer}>
        {selectedId && (
          <Text style={styles.hint}>Tap a tier to place the selected item</Text>
        )}
        <Pressable
          style={({ pressed }) => [
            styles.lockButton,
            (!allPlaced || submitting) && styles.lockButtonDisabled,
            pressed && allPlaced && !submitting && styles.lockButtonPressed,
          ]}
          onPress={handleLockIn}
          disabled={!allPlaced || submitting}
        >
          <Text style={styles.lockButtonText}>
            {submitting ? "Locking in..." : allPlaced ? "Lock in my board" : `Place all ${items.length} items`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  topic: {
    ...typography.h2,
    color: colors.charcoal,
    flex: 1,
    marginRight: spacing.md,
  },
  progress: {
    ...typography.bodyBold,
    color: colors.coral,
  },
  boardScroll: {
    paddingBottom: spacing.md,
  },
  poolLabel: {
    ...typography.tiny,
    color: colors.mist,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  footer: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  hint: {
    ...typography.caption,
    color: colors.slate,
    textAlign: "center",
  },
  lockButton: {
    backgroundColor: colors.coral,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
  },
  lockButtonDisabled: {
    opacity: 0.5,
  },
  lockButtonPressed: {
    backgroundColor: colors.coralDark,
    transform: [{ scale: 0.98 }],
  },
  lockButtonText: {
    color: colors.warmWhite,
    fontSize: 18,
    fontWeight: "700",
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
  retryText: {
    color: colors.warmWhite,
    ...typography.bodyBold,
  },
});
