import type { Mode, Tier } from "@tot/shared";
import type { RoomStatus } from "./modes";

export type { Tier };

// Override for local development: EXPO_PUBLIC_API_BASE=http://localhost:8787/api
const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "https://tot-api.kcselm93.workers.dev/api";

const FRIENDLY_MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: "That room doesn't exist or has expired.",
  ROOM_EXPIRED: "This room has expired.",
  NOT_CREATOR: "Only the room creator can do that.",
  INVALID_STATUS: "This action isn't available right now.",
  VALIDATION_ERROR: "Please check your input and try again.",
  NOT_NEXT_HOST: "The host picked someone else to create the next round.",
  SERIES_CONTINUED: "The next round has already been created.",
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
  } catch {
    throw new ApiError(
      "Can't connect to the server. Check your internet connection.",
      "NETWORK_ERROR",
      0
    );
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new ApiError("Something went wrong. Please try again.", "PARSE_ERROR", res.status);
  }

  if (!res.ok) {
    const code = data?.error?.code ?? "UNKNOWN";
    const message = FRIENDLY_MESSAGES[code] ?? data?.error?.message ?? "Something went wrong.";
    throw new ApiError(message, code, res.status);
  }

  return data as T;
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// --- Room endpoints ---

export type CreateRoomResponse = {
  id: string;
  code: string;
  topic: string;
  mode: Mode;
  createdAt: string;
  expiresAt: string;
  roundNumber?: number;
};

export function createRoom(body: {
  topic: string;
  creatorVoterId: string;
  creatorName: string;
  allowSuggestions?: boolean;
  mode?: Mode;
  previousRoomCode?: string;
}) {
  return request<CreateRoomResponse>("/rooms", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type AddItemsResponse = {
  items: { id: string; title: string; sortOrder: number }[];
  totalItems: number;
};

export function addItems(code: string, body: { items: string[]; creatorVoterId: string }) {
  return request<AddItemsResponse>(`/rooms/${code}/items`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function addItem(code: string, body: { item: string; creatorVoterId?: string; voterId?: string; voterName?: string }) {
  return request<AddItemsResponse>(`/rooms/${code}/items`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateRoomSettings(code: string, body: { creatorVoterId: string; allowSuggestions: boolean }) {
  return request<{ success: boolean; allowSuggestions: boolean }>(`/rooms/${code}/settings`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteItem(code: string, itemId: string, creatorVoterId: string) {
  return request<{ success: boolean; totalItems: number }>(
    `/rooms/${code}/items/${encodeURIComponent(itemId)}?creatorVoterId=${encodeURIComponent(creatorVoterId)}`,
    { method: "DELETE" }
  );
}

export function closeRoom(code: string, creatorVoterId: string) {
  return request<{ success: boolean; status: string }>(`/rooms/${code}/close`, {
    method: "POST",
    body: JSON.stringify({ creatorVoterId }),
  });
}

export function startVoting(code: string, creatorVoterId: string) {
  return request<{ success: boolean; status: string; itemCount: number }>(
    `/rooms/${code}/start`,
    { method: "POST", body: JSON.stringify({ creatorVoterId }) }
  );
}

export type RoomItem = {
  id: string;
  title: string;
  addedBy: { name: string } | null;
};

export type RoomResponse = {
  id: string;
  code: string;
  topic: string;
  status: RoomStatus;
  allowSuggestions: boolean;
  mode: Mode;
  items: RoomItem[];
  myVotes?: Record<string, string>;
  myRankings?: Record<string, number>;
  myMltVotes?: Record<string, string>;
  myTiers?: Record<string, string>;
  roundNumber?: number;
  nextRoomCode?: string;
};

export function getRoom(code: string, voterId?: string) {
  const params = voterId ? `?voterId=${encodeURIComponent(voterId)}` : "";
  return request<RoomResponse>(`/rooms/${code}${params}`);
}

// --- Participant endpoints ---

export type Participant = {
  participantId: string;
  name: string;
  isCreator: boolean;
  isYou: boolean;
};

export function joinRoom(code: string, body: { voterId: string; voterName: string }) {
  return request<{ success: boolean }>(`/rooms/${code}/join`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getParticipants(code: string, voterId?: string) {
  const params = voterId ? `?voterId=${encodeURIComponent(voterId)}` : "";
  return request<{ participants: Participant[] }>(`/rooms/${code}/participants${params}`);
}

// --- Vote endpoints ---

export type VoteResponse = {
  success: boolean;
  progress: { voted: number; total: number };
};

export function submitVote(
  code: string,
  body: { itemId: string; voterId: string; voterName: string; vote: "yes" | "no" }
) {
  return request<VoteResponse>(`/rooms/${code}/votes`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// --- Status/Results endpoints ---

export type StatusResponse = {
  totalVoters: number;
  completedCount: number;
  isRevealed: boolean;
  currentRound?: number | null;
  roundNumber?: number;
  nextHost?: { participantId: string; name: string } | null;
  nextRoomCode?: string | null;
  voters: { name: string; completed: boolean }[];
};

export function getStatus(code: string) {
  return request<StatusResponse>(`/rooms/${code}/status`);
}

export function pickNextHost(
  code: string,
  body: { creatorVoterId: string; nextParticipantId?: string }
) {
  return request<{ nextHost: { participantId: string; name: string } }>(
    `/rooms/${code}/next-host`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

// --- Rankings endpoints (blind rank mode) ---

export type NextItemResponse = {
  item: { id: string; title: string } | null;
  progress: { placed: number; total: number };
};

export function getNextRankItem(code: string, voterId: string) {
  return request<NextItemResponse>(
    `/rooms/${code}/next-item?voterId=${encodeURIComponent(voterId)}`
  );
}

export type RankingSubmitResponse = {
  success: boolean;
  progress: { placed: number; total: number };
};

export function submitRanking(
  code: string,
  body: { itemId: string; voterId: string; voterName: string; rank: number }
) {
  return request<RankingSubmitResponse>(`/rooms/${code}/rankings`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// --- Results ---
// Every results payload carries `mode`, so screens switch on it directly.
// (Snapshots saved before swipe-vote results had a mode are normalized in
// saved-results.ts.)

export type VoteResults = {
  revealed: true;
  mode: "vote";
  topic: string;
  totalVoters: number;
  results: {
    itemId: string;
    title: string;
    yesCount: number;
    noCount: number;
    yesPercentage: number;
  }[];
};

export type RankResults = {
  revealed: true;
  mode: "rank";
  topic: string;
  players: {
    participantId: string;
    name: string;
    isCreator: boolean;
    isYou: boolean;
    rankings: { rank: number; itemId: string; title: string }[];
  }[];
};

export type RevealedResults = VoteResults | RankResults | BracketResults | MltResults | TierResults;

export type PendingResults = {
  revealed: false;
  mode: Mode;
  completedCount: number;
  totalVoters: number;
  /** Bracket only: the round being played and its real matchup count. */
  currentRound?: number | null;
  totalThisRound?: number;
};

export type ResultsResponse = RevealedResults | PendingResults;

export function getResults(code: string, voterId?: string) {
  const params = voterId ? `?voterId=${encodeURIComponent(voterId)}` : "";
  return request<ResultsResponse>(`/rooms/${code}/results${params}`);
}

export function revealResults(code: string, creatorVoterId: string) {
  return request<{ success: boolean; status: string }>(`/rooms/${code}/reveal`, {
    method: "POST",
    body: JSON.stringify({ creatorVoterId }),
  });
}

// --- Bracket endpoints ---

export type BracketMatchup = {
  id: string;
  slot: number;
  itemA: { id: string; title: string } | null;
  itemB: { id: string; title: string } | null;
  winner: { id: string; title: string } | null;
  isBye: boolean;
  decidedByTiebreak: boolean;
  voteBreakdown?: { voterName: string; pickedItemId: string; isYou: boolean }[];
};

export type BracketRound = {
  round: number;
  matchups: BracketMatchup[];
};

export type BracketResponse = {
  currentRound: number | null;
  totalRounds: number;
  rounds: BracketRound[];
  myVotes: Record<string, string>; // matchupId -> pickedItemId
};

export function getBracket(code: string, voterId: string) {
  return request<BracketResponse>(
    `/rooms/${code}/bracket?voterId=${encodeURIComponent(voterId)}`
  );
}

export type MatchupVoteResponse = {
  success: boolean;
  progress: { votedThisRound: number; totalThisRound: number };
};

export function submitMatchupVote(
  code: string,
  body: { matchupId: string; voterId: string; voterName: string; pickedItemId: string }
) {
  return request<MatchupVoteResponse>(`/rooms/${code}/matchup-votes`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// --- Bracket results ---

export type BracketResults = {
  revealed: true;
  mode: "bracket";
  topic: string;
  totalRounds: number;
  winner: { id: string; title: string } | null;
  rounds: BracketRound[];
};

// --- Most Likely To endpoints ---

export type MltPrompt = {
  id: string;
  text: string;
  tags?: string[];
};

export type MltPromptsResponse = {
  prompts: MltPrompt[];
};

export function getMltPrompts() {
  return request<MltPromptsResponse>("/mlt/prompts");
}

export type SubmitMltVoteBody = {
  itemId: string;
  voterId: string;
  voterName: string;
  targetParticipantId: string;
};

export type SubmitMltVoteResponse = {
  success: true;
  progress: { voted: number; total: number };
};

export function submitMltVote(code: string, body: SubmitMltVoteBody) {
  return request<SubmitMltVoteResponse>(`/rooms/${code}/mlt-votes`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type MltPromptResult = {
  itemId: string;
  text: string;
  sortOrder: number;
  tallies: { targetParticipantId: string; name: string; count: number }[];
  winners: { participantId: string; name: string }[];
  totalVotes: number;
};

export type MltLeaderboardEntry = {
  participantId: string;
  name: string;
  wins: number;
  isYou: boolean;
};

export type MltResults = {
  revealed: true;
  mode: "mlt";
  topic: string;
  prompts: MltPromptResult[];
  leaderboard: MltLeaderboardEntry[];
};

// --- Tier list endpoints (tier mode) ---

export type TierPlacementInput = { itemId: string; tier: Tier };

export type SubmitTierBoardResponse = {
  success: boolean;
  progress: { placed: number; total: number };
  isRevealed: boolean;
};

export function submitTierBoard(
  code: string,
  body: { voterId: string; voterName: string; placements: TierPlacementInput[] }
) {
  return request<SubmitTierBoardResponse>(`/rooms/${code}/tiers`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type TierConsensusRow = {
  tier: Tier;
  items: { itemId: string; title: string; average: number }[];
};

export type TierPlayerBoard = {
  participantId: string;
  name: string;
  isCreator: boolean;
  isYou: boolean;
  placements: { itemId: string; title: string; tier: Tier }[];
};

export type TierResults = {
  revealed: true;
  mode: "tier";
  topic: string;
  consensus: TierConsensusRow[];
  players: TierPlayerBoard[];
};
