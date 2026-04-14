import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const VOTER_ID_KEY = "tot_voter_id";

export async function getVoterId(): Promise<string> {
  // On web, use sessionStorage so each tab gets its own identity (useful for testing).
  // On native, use AsyncStorage so the ID persists across app restarts.
  if (Platform.OS === "web") {
    let id = sessionStorage.getItem(VOTER_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(VOTER_ID_KEY, id);
    }
    return id;
  }

  let id = await AsyncStorage.getItem(VOTER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    await AsyncStorage.setItem(VOTER_ID_KEY, id);
  }
  return id;
}
