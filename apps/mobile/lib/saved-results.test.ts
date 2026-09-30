import { describe, it, expect } from "vitest";
import {
  toSavedResult,
  pruneExpired,
  upsertResult,
  expiresAt,
  headline,
  withMode,
  type RevealedResults,
} from "./saved-results";

const vote: RevealedResults = {
  revealed: true,
  mode: "vote",
  topic: "Dinner",
  totalVoters: 3,
  results: [
    { itemId: "a", title: "Tacos", yesCount: 3, noCount: 0, yesPercentage: 100 },
    { itemId: "b", title: "Sushi", yesCount: 1, noCount: 2, yesPercentage: 33 },
  ],
};

const bracket: RevealedResults = {
  revealed: true,
  mode: "bracket",
  topic: "Movies",
  totalRounds: 2,
  winner: { id: "x", title: "Alien" },
  rounds: [],
};

const now = new Date("2026-09-29T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

describe("toSavedResult", () => {
  it("captures topic and mode, defaulting to vote", () => {
    const saved = toSavedResult("abc123", vote, now);
    expect(saved).toMatchObject({ code: "ABC123", topic: "Dinner", mode: "vote" });
    expect(toSavedResult("X", bracket, now).mode).toBe("bracket");
  });
});

describe("pruneExpired", () => {
  it("keeps snapshots inside 30 days and drops older ones", () => {
    const fresh = toSavedResult("AAA", vote, daysAgo(29));
    const stale = toSavedResult("BBB", vote, daysAgo(31));
    expect(pruneExpired([fresh, stale], now).map((e) => e.code)).toEqual(["AAA"]);
  });
});

describe("upsertResult", () => {
  it("replaces an existing snapshot for the same code", () => {
    const first = toSavedResult("AAA", vote, daysAgo(10));
    const other = toSavedResult("BBB", bracket, daysAgo(5));
    const again = toSavedResult("AAA", vote, now);
    const res = upsertResult([first, other], again);
    expect(res).toHaveLength(2);
    expect(res.find((e) => e.code === "AAA")?.savedAt).toBe(now.toISOString());
  });
});

describe("expiresAt", () => {
  it("is 30 days after saving", () => {
    expect(expiresAt(toSavedResult("A", vote, now)).toISOString()).toBe("2026-10-29T12:00:00.000Z");
  });
});

describe("headline", () => {
  it("names the top vote pick and the bracket winner", () => {
    expect(headline(vote)).toBe("Tacos");
    expect(headline(bracket)).toBe("Alien");
  });

  it("has no headline for a draft, which has no winner", () => {
    const draft: RevealedResults = {
      revealed: true,
      mode: "draft",
      topic: "Pizza toppings",
      draftOrder: "snake",
      rounds: 1,
      totalPicks: 2,
      picksMade: 2,
      players: [
        {
          seat: 0,
          participantId: "p1",
          name: "Alex",
          isCreator: true,
          isYou: false,
          picks: [{ pickIndex: 0, round: 0, title: "Pepperoni" }],
        },
      ],
    };
    expect(headline(draft)).toBeNull();
  });
});

describe("withMode", () => {
  it("marks snapshots saved before results carried a mode as swipe vote", () => {
    const { mode: _mode, ...legacy } = vote;
    expect(withMode(legacy)).toEqual(vote);
    expect(headline(withMode(legacy))).toBe("Tacos");
  });

  it("leaves current snapshots alone", () => {
    expect(withMode(bracket)).toBe(bracket);
  });
});
