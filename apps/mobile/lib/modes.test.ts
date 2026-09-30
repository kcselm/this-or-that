import { describe, it, expect } from "vitest";
import { parseMode, playScreen, roomScreen, startBlocker } from "./modes";

describe("roomScreen", () => {
  it("sends the host to setup and everyone else to the lobby while open", () => {
    expect(roomScreen("open", "vote", true)).toBe("/create/share");
    expect(roomScreen("open", "vote", false)).toBe("/room/[code]/lobby");
  });

  it("sends everyone to the mode's play screen once voting starts", () => {
    expect(roomScreen("voting", "vote", false)).toBe("/room/[code]/swipe");
    expect(roomScreen("voting", "rank", true)).toBe("/room/[code]/rank");
    expect(roomScreen("voting", "tier", false)).toBe(playScreen("tier"));
  });

  it("sends everyone to results once revealed, and nowhere once closed", () => {
    expect(roomScreen("revealed", "mlt", false)).toBe("/room/[code]/results");
    expect(roomScreen("closed", "mlt", true)).toBeNull();
  });
});

describe("parseMode", () => {
  it("accepts known modes and falls back to swipe vote", () => {
    expect(parseMode("bracket")).toBe("bracket");
    expect(parseMode("poll")).toBe("vote");
    expect(parseMode(undefined)).toBe("vote");
  });
});

describe("startBlocker", () => {
  it("explains a missing item count", () => {
    expect(startBlocker("vote", 1, 1)).toBe("Add at least 2 items to start.");
    expect(startBlocker("rank", 4, 3)).toBe("Add exactly 5 items to start (4/5).");
  });

  it("explains a missing player count once the items are ready", () => {
    expect(startBlocker("mlt", 3, 2)).toBe("2 of 3 joined — share the code to fill the room.");
  });

  it("is null when the room can start", () => {
    expect(startBlocker("bracket", 8, 1)).toBeNull();
    expect(startBlocker("mlt", 3, 3)).toBeNull();
  });
});
