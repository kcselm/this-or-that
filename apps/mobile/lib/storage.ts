import AsyncStorage from "@react-native-async-storage/async-storage";

const VOTER_ID_KEY = "tot_voter_id";

export async function getVoterId(): Promise<string> {
  let id = await AsyncStorage.getItem(VOTER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    await AsyncStorage.setItem(VOTER_ID_KEY, id);
  }
  return id;
}
