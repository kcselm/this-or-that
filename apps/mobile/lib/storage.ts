import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

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
