import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, Layout } from "react-native-reanimated";
import {
  getMltPrompts,
  addItems,
  ApiError,
  type MltPrompt,
} from "../../lib/api";
import { getVoterId } from "../../lib/storage";
import { showAlert } from "../../lib/alert";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";

const MAX_PROMPTS = 15;
const MAX_PROMPT_LENGTH = 80;
const PICK_FOR_ME_COUNT = 7;

type SelectedPrompt = { text: string; libraryId: string | null };

export default function MltPromptsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code, name, mode } = useLocalSearchParams<{
    code: string;
    name?: string;
    mode?: string;
  }>();

  const [library, setLibrary] = useState<MltPrompt[]>([]);
  const [selected, setSelected] = useState<SelectedPrompt[]>([]);
  const [customDraft, setCustomDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getMltPrompts();
      setLibrary(res.prompts);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load prompt library.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  const isSelected = (libraryId: string) =>
    selected.some((s) => s.libraryId === libraryId);

  const togglePrompt = (prompt: MltPrompt) => {
    setSelected((prev) => {
      const existing = prev.findIndex((s) => s.libraryId === prompt.id);
      if (existing >= 0) {
        return prev.filter((_, i) => i !== existing);
      }
      if (prev.length >= MAX_PROMPTS) return prev;
      return [...prev, { text: prompt.text, libraryId: prompt.id }];
    });
  };

  const removeSelected = (index: number) => {
    setSelected((prev) => prev.filter((_, i) => i !== index));
  };

  const addCustom = () => {
    const text = customDraft.trim();
    if (!text) return;
    if (text.length > MAX_PROMPT_LENGTH) return;
    if (selected.length >= MAX_PROMPTS) return;
    setSelected((prev) => [...prev, { text, libraryId: null }]);
    setCustomDraft("");
  };

  const pickForMe = () => {
    const shuffled = [...library].sort(() => Math.random() - 0.5);
    const picks = shuffled.slice(0, Math.min(PICK_FOR_ME_COUNT, library.length));
    setSelected(picks.map((p) => ({ text: p.text, libraryId: p.id })));
  };

  const handleContinue = async () => {
    if (selected.length < 3) {
      showAlert("Need more prompts", "Pick at least 3 prompts to continue.");
      return;
    }
    setSaving(true);
    try {
      const voterId = await getVoterId();
      await addItems(code, {
        items: selected.map((s) => s.text),
        creatorVoterId: voterId,
      });
      router.replace({ pathname: "/create/share", params: { code, name, mode } });
    } catch (e) {
      showAlert(
        "Couldn't save prompts",
        e instanceof ApiError ? e.message : "Try again."
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable
          style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
          onPress={loadLibrary}
        >
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>Pick your prompts</Text>
        <Text style={styles.subhead}>
          {selected.length} of {MAX_PROMPTS} selected
        </Text>

        {/* Selected row */}
        {selected.length > 0 && (
          <View style={styles.selectedSection}>
            {selected.map((s, i) => (
              <Animated.View
                key={`${s.libraryId ?? "custom"}-${i}-${s.text}`}
                entering={FadeInDown.duration(200)}
                layout={Layout.springify()}
                style={styles.selectedChip}
              >
                <Text style={styles.selectedText} numberOfLines={2}>
                  {s.text}
                </Text>
                <Pressable onPress={() => removeSelected(i)} hitSlop={8}>
                  <Text style={styles.removeX}>×</Text>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        )}

        {/* Pick-for-me */}
        <Pressable style={styles.pickForMeBtn} onPress={pickForMe}>
          <Text style={styles.pickForMeText}>Pick {PICK_FOR_ME_COUNT} for me</Text>
        </Pressable>

        {/* Library */}
        <Text style={styles.sectionLabel}>Library</Text>
        {library.map((p) => {
          const sel = isSelected(p.id);
          return (
            <Pressable
              key={p.id}
              onPress={() => togglePrompt(p)}
              style={[styles.libraryCard, sel && styles.libraryCardSelected]}
              disabled={!sel && selected.length >= MAX_PROMPTS}
            >
              <Text style={[styles.libraryText, sel && styles.libraryTextSelected]}>
                {p.text}
              </Text>
              <Text style={styles.libraryAddIcon}>{sel ? "✓" : "+"}</Text>
            </Pressable>
          );
        })}

        {/* Custom input */}
        <Text style={styles.sectionLabel}>Add a custom prompt</Text>
        <View style={styles.customRow}>
          <TextInput
            value={customDraft}
            onChangeText={setCustomDraft}
            placeholder="Most likely to..."
            maxLength={MAX_PROMPT_LENGTH}
            style={styles.customInput}
            onSubmitEditing={addCustom}
            returnKeyType="done"
          />
          <Pressable
            onPress={addCustom}
            style={[
              styles.customAddBtn,
              (!customDraft.trim() || selected.length >= MAX_PROMPTS) && styles.disabled,
            ]}
            disabled={!customDraft.trim() || selected.length >= MAX_PROMPTS}
          >
            <Text style={styles.customAddText}>Add</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Sticky bottom continue */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          style={[
            styles.continueBtn,
            (selected.length < 3 || saving) && styles.disabled,
          ]}
          disabled={selected.length < 3 || saving}
          onPress={handleContinue}
        >
          <Text style={styles.continueText}>
            {saving ? "Saving..." : `Continue (${selected.length})`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.cream },
  scrollContent: { padding: spacing.xl, paddingBottom: 120 },
  center: { alignItems: "center", justifyContent: "center" },
  heading: { ...typography.h1, color: colors.charcoal, marginBottom: spacing.xs },
  subhead: { ...typography.body, color: colors.slate, marginBottom: spacing.lg },
  selectedSection: { gap: spacing.sm, marginBottom: spacing.lg },
  selectedChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.warmWhite,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.coral,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.soft,
  },
  selectedText: { ...typography.body, color: colors.charcoal, flex: 1 },
  removeX: { fontSize: 24, color: colors.slate, paddingLeft: spacing.sm, lineHeight: 24 },
  pickForMeBtn: {
    alignSelf: "flex-start",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.coral,
    marginBottom: spacing.lg,
  },
  pickForMeText: { ...typography.body, color: colors.coral, fontWeight: "600" },
  sectionLabel: {
    ...typography.body,
    fontWeight: "600",
    color: colors.charcoal,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  libraryCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.warmWhite,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.sand,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  libraryCardSelected: {
    backgroundColor: colors.sandLight,
    borderColor: colors.coral,
  },
  libraryText: { ...typography.body, color: colors.charcoal, flex: 1 },
  libraryTextSelected: { color: colors.charcoal, opacity: 0.7 },
  libraryAddIcon: { fontSize: 22, color: colors.coral, paddingLeft: spacing.sm },
  customRow: { flexDirection: "row", gap: spacing.sm },
  customInput: {
    flex: 1,
    backgroundColor: colors.warmWhite,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.sand,
    padding: spacing.md,
    ...typography.body,
  },
  customAddBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.coral,
    borderRadius: radius.md,
  },
  customAddText: { ...typography.body, color: "#fff", fontWeight: "600" },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.xl,
    backgroundColor: colors.cream,
    borderTopWidth: 1,
    borderTopColor: colors.sand,
  },
  continueBtn: {
    backgroundColor: colors.coral,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: "center",
  },
  continueText: { ...typography.h3, color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.4 },
  errorText: { ...typography.body, color: colors.slate, textAlign: "center" },
  retryButton: {
    backgroundColor: colors.coral,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    marginTop: spacing.lg,
  },
  retryButtonPressed: {
    backgroundColor: colors.coralDark,
  },
  retryText: {
    color: colors.warmWhite,
    ...typography.bodyBold,
  },
});
