import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import type { SavedList } from "./saved-lists";
import {
  pruneExpired,
  toSavedResult,
  upsertResult,
  withMode,
  type RevealedResults,
  type SavedResult,
} from "./saved-results";

const VOTER_ID_KEY = "tot_voter_id";
const ACTIVE_ROOM_KEY = "tot_active_room";

export type ActiveRoom = {
  code: string;
  topic: string;
  name: string;
  isCreator?: boolean;
};

export async function getVoterId(): Promise<string> {
  // On web, use sessionStorage so each tab gets its own identity (useful for testing).
  // On native, use AsyncStorage so the ID persists across app restarts.
  if (Platform.OS === "web") {
    let id = sessionStorage.getItem(VOTER_ID_KEY);
    if (!id) {
      id = Crypto.randomUUID();
      sessionStorage.setItem(VOTER_ID_KEY, id);
    }
    return id;
  }

  let id = await AsyncStorage.getItem(VOTER_ID_KEY);
  if (!id) {
    id = Crypto.randomUUID();
    await AsyncStorage.setItem(VOTER_ID_KEY, id);
  }
  return id;
}

export async function saveActiveRoom(room: ActiveRoom): Promise<void> {
  const json = JSON.stringify(room);
  if (Platform.OS === "web") {
    sessionStorage.setItem(ACTIVE_ROOM_KEY, json);
    return;
  }
  await AsyncStorage.setItem(ACTIVE_ROOM_KEY, json);
}

export async function getActiveRoom(): Promise<ActiveRoom | null> {
  let json: string | null;
  if (Platform.OS === "web") {
    json = sessionStorage.getItem(ACTIVE_ROOM_KEY);
  } else {
    json = await AsyncStorage.getItem(ACTIVE_ROOM_KEY);
  }
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function clearActiveRoom(): Promise<void> {
  if (Platform.OS === "web") {
    sessionStorage.removeItem(ACTIVE_ROOM_KEY);
    return;
  }
  await AsyncStorage.removeItem(ACTIVE_ROOM_KEY);
}

// --- Tier list in-progress board draft (local only, keyed by room code) ---

function tierDraftKey(code: string): string {
  return `tot_tier_draft_${code.toUpperCase()}`;
}

export async function saveTierDraft(
  code: string,
  placement: Record<string, string>
): Promise<void> {
  const json = JSON.stringify(placement);
  if (Platform.OS === "web") {
    sessionStorage.setItem(tierDraftKey(code), json);
    return;
  }
  await AsyncStorage.setItem(tierDraftKey(code), json);
}

export async function getTierDraft(
  code: string
): Promise<Record<string, string> | null> {
  let json: string | null;
  if (Platform.OS === "web") {
    json = sessionStorage.getItem(tierDraftKey(code));
  } else {
    json = await AsyncStorage.getItem(tierDraftKey(code));
  }
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function clearTierDraft(code: string): Promise<void> {
  if (Platform.OS === "web") {
    sessionStorage.removeItem(tierDraftKey(code));
    return;
  }
  await AsyncStorage.removeItem(tierDraftKey(code));
}

// --- Durable local collections (saved lists, results history) ---
// Unlike the per-tab session data above, these use localStorage on web: the
// whole point is that they outlive the tab.

async function readLocalArray<T>(key: string): Promise<T[]> {
  const json =
    Platform.OS === "web" ? localStorage.getItem(key) : await AsyncStorage.getItem(key);
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLocalArray<T>(key: string, value: T[]): Promise<void> {
  const json = JSON.stringify(value);
  if (Platform.OS === "web") {
    localStorage.setItem(key, json);
    return;
  }
  await AsyncStorage.setItem(key, json);
}

// Edits save on every keystroke; chain read-modify-writes so a slow write
// can't clobber a newer one.
let localWriteQueue: Promise<unknown> = Promise.resolve();

function mutateLocalArray<T>(key: string, fn: (value: T[]) => T[]): Promise<void> {
  const next = localWriteQueue.then(async () => {
    await writeLocalArray(key, fn(await readLocalArray<T>(key)));
  });
  localWriteQueue = next.catch(() => {});
  return next;
}

// --- Saved lists (reusable across rooms) ---

const SAVED_LISTS_KEY = "tot_saved_lists";

const readSavedLists = () => readLocalArray<SavedList>(SAVED_LISTS_KEY);
const mutateSavedLists = (fn: (lists: SavedList[]) => SavedList[]) =>
  mutateLocalArray(SAVED_LISTS_KEY, fn);

/** All saved lists, most recently edited first. */
export async function getSavedLists(): Promise<SavedList[]> {
  const lists = await readSavedLists();
  return lists.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getSavedList(id: string): Promise<SavedList | null> {
  const lists = await readSavedLists();
  return lists.find((l) => l.id === id) ?? null;
}

export async function createSavedList(name = "", items: string[] = []): Promise<SavedList> {
  const list: SavedList = {
    id: Crypto.randomUUID(),
    name,
    items,
    updatedAt: new Date().toISOString(),
  };
  await mutateSavedLists((lists) => [...lists, list]);
  return list;
}

export async function updateSavedList(
  id: string,
  changes: Partial<Pick<SavedList, "name" | "items">>
): Promise<void> {
  await mutateSavedLists((lists) =>
    lists.map((l) =>
      l.id === id ? { ...l, ...changes, updatedAt: new Date().toISOString() } : l
    )
  );
}

export async function deleteSavedList(id: string): Promise<void> {
  await mutateSavedLists((lists) => lists.filter((l) => l.id !== id));
}

// --- Results history (snapshots kept for RESULTS_RETENTION_DAYS) ---

const SAVED_RESULTS_KEY = "tot_saved_results";

/** Saved results still inside the retention window, newest first. */
export async function getSavedResults(): Promise<SavedResult[]> {
  const all = await readLocalArray<SavedResult>(SAVED_RESULTS_KEY);
  const kept = pruneExpired(all, new Date()).map((e) => ({ ...e, data: withMode(e.data) }));
  if (kept.length !== all.length) {
    await mutateLocalArray<SavedResult>(SAVED_RESULTS_KEY, (entries) =>
      pruneExpired(entries, new Date())
    );
  }
  return kept.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function getSavedResult(code: string): Promise<SavedResult | null> {
  const entries = await getSavedResults();
  return entries.find((e) => e.code === code.toUpperCase()) ?? null;
}

export async function saveResult(code: string, data: RevealedResults): Promise<void> {
  const entry = toSavedResult(code, data, new Date());
  await mutateLocalArray<SavedResult>(SAVED_RESULTS_KEY, (entries) =>
    upsertResult(pruneExpired(entries, new Date()), entry)
  );
}

export async function deleteSavedResult(code: string): Promise<void> {
  await mutateLocalArray<SavedResult>(SAVED_RESULTS_KEY, (entries) =>
    entries.filter((e) => e.code !== code.toUpperCase())
  );
}
