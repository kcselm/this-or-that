const API_BASE = "https://tot-api.kcselm93.workers.dev/api";

const FRIENDLY_MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: "That room doesn't exist or has expired.",
  ROOM_EXPIRED: "This room has expired.",
  NOT_CREATOR: "Only the room creator can do that.",
  INVALID_STATUS: "This action isn't available right now.",
  VALIDATION_ERROR: "Please check your input and try again.",
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
  createdAt: string;
  expiresAt: string;
};

export function createRoom(body: {
  topic: string;
  creatorVoterId: string;
  creatorName: string;
  allowSuggestions?: boolean;
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
    `/rooms/${code}/items/${itemId}?creatorVoterId=${creatorVoterId}`,
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
  addedBy: { voterId: string; name: string } | null;
};

export type RoomResponse = {
  id: string;
  code: string;
  topic: string;
  status: "open" | "voting" | "revealed" | "closed";
  allowSuggestions: boolean;
  items: RoomItem[];
  myVotes?: Record<string, string>;
};

export function getRoom(code: string, voterId?: string) {
  const params = voterId ? `?voterId=${voterId}` : "";
  return request<RoomResponse>(`/rooms/${code}${params}`);
}

// --- Participant endpoints ---

export type Participant = {
  voterId: string;
  name: string;
  isCreator: boolean;
};

export function joinRoom(code: string, body: { voterId: string; voterName: string }) {
  return request<{ success: boolean }>(`/rooms/${code}/join`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getParticipants(code: string) {
  return request<{ participants: Participant[] }>(`/rooms/${code}/participants`);
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
  voters: { name: string; completed: boolean }[];
};

export function getStatus(code: string) {
  return request<StatusResponse>(`/rooms/${code}/status`);
}

export type ResultsResponse =
  | {
      revealed: true;
      topic: string;
      totalVoters: number;
      results: {
        itemId: string;
        title: string;
        yesCount: number;
        noCount: number;
        yesPercentage: number;
      }[];
    }
  | {
      revealed: false;
      completedCount: number;
      totalVoters: number;
    };

export function getResults(code: string) {
  return request<ResultsResponse>(`/rooms/${code}/results`);
}

export function revealResults(code: string, creatorVoterId: string) {
  return request<{ success: boolean; status: string }>(`/rooms/${code}/reveal`, {
    method: "POST",
    body: JSON.stringify({ creatorVoterId }),
  });
}
