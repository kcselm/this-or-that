const API_BASE = __DEV__
  ? "http://localhost:8787/api"
  : "https://api.thisorthat.app/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(
      data?.error?.message ?? "Something went wrong",
      data?.error?.code ?? "UNKNOWN",
      res.status
    );
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
  expectedCount: number;
  createdAt: string;
  expiresAt: string;
};

export function createRoom(body: {
  topic: string;
  expectedCount: number;
  creatorVoterId: string;
  creatorName: string;
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

export function deleteItem(code: string, itemId: string, creatorVoterId: string) {
  return request<{ success: boolean; totalItems: number }>(
    `/rooms/${code}/items/${itemId}?creatorVoterId=${creatorVoterId}`,
    { method: "DELETE" }
  );
}

export function startVoting(code: string, creatorVoterId: string) {
  return request<{ success: boolean; status: string; itemCount: number }>(
    `/rooms/${code}/start`,
    { method: "POST", body: JSON.stringify({ creatorVoterId }) }
  );
}

export type RoomResponse = {
  id: string;
  code: string;
  topic: string;
  expectedCount: number;
  status: "open" | "voting" | "revealed";
  items: { id: string; title: string }[];
  myVotes?: Record<string, string>;
};

export function getRoom(code: string, voterId?: string) {
  const params = voterId ? `?voterId=${voterId}` : "";
  return request<RoomResponse>(`/rooms/${code}${params}`);
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
  expectedCount: number;
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
      expectedCount: number;
    };

export function getResults(code: string) {
  return request<ResultsResponse>(`/rooms/${code}/results`);
}
