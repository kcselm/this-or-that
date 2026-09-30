import { describe, it, expect } from "vitest";
import { splitTitle, wrapLines, fitTitle } from "./matchup-text";

describe("splitTitle", () => {
  it("leaves a plain title alone", () => {
    expect(splitTitle("Wings of Desire")).toEqual({ name: "Wings of Desire", note: null });
  });

  it("splits a name from a trailing note on a spaced hyphen", () => {
    expect(splitTitle("The Wolfpack - Six brothers raised in a flat")).toEqual({
      name: "The Wolfpack",
      note: "Six brothers raised in a flat",
    });
  });

  it("accepts en and em dashes", () => {
    expect(splitTitle("Alien \u2013 1979 horror").note).toBe("1979 horror");
    expect(splitTitle("Alien \u2014 1979 horror").note).toBe("1979 horror");
  });

  it("only splits on the first separator", () => {
    expect(splitTitle("A - b - c")).toEqual({ name: "A", note: "b - c" });
  });

  it("ignores a hyphen with nothing after it", () => {
    expect(splitTitle("Spider-Man")).toEqual({ name: "Spider-Man", note: null });
    expect(splitTitle("Trainspotting - ")).toEqual({ name: "Trainspotting", note: null });
  });
});

describe("wrapLines", () => {
  it("is zero for empty text", () => {
    expect(wrapLines("", 200, 16)).toBe(0);
  });

  it("keeps short text on one line", () => {
    expect(wrapLines("Pizza", 200, 16)).toBe(1);
  });

  it("wraps at word boundaries", () => {
    // 16px face => ~8.8px per char => 22 chars per 200px line.
    expect(wrapLines("one two three four five six seven", 200, 16)).toBeGreaterThan(1);
  });

  it("needs more lines as the box narrows", () => {
    const text = "Six brothers raised locked inside a Manhattan flat";
    expect(wrapLines(text, 120, 16)).toBeGreaterThan(wrapLines(text, 320, 16));
  });

  it("breaks a word that is wider than the line", () => {
    expect(wrapLines("aaaaaaaaaaaaaaaaaaaa", 40, 16)).toBeGreaterThan(1);
  });
});

const LONG =
  "The Wolfpack - Six brothers raised locked inside a Manhattan flat learn about life by reenacting the";

function blockHeight(fit: ReturnType<typeof fitTitle>): number {
  const name = fit.name.maxLines * fit.name.lineHeight;
  const note = fit.note ? fit.note.maxLines * fit.note.lineHeight + fit.gap : 0;
  return name + note;
}

describe("fitTitle", () => {
  it("shows a long title whole in a phone-width card", () => {
    const fit = fitTitle(LONG, 300, 220);
    expect(fit.name.maxLines).toBeGreaterThanOrEqual(
      wrapLines("The Wolfpack", 300, fit.name.fontSize)
    );
    expect(fit.note!.maxLines).toBeGreaterThanOrEqual(
      wrapLines(splitTitle(LONG).note!, 300, fit.note!.fontSize)
    );
    expect(blockHeight(fit)).toBeLessThanOrEqual(220);
  });

  it("shrinks the face rather than clipping when the card is narrow", () => {
    const wide = fitTitle(LONG, 320, 220);
    const narrow = fitTitle(LONG, 140, 220);
    expect(narrow.name.fontSize).toBeLessThan(wide.name.fontSize);
    expect(blockHeight(narrow)).toBeLessThanOrEqual(220);
  });

  it("gives a short title a large face", () => {
    expect(fitTitle("Pizza", 300, 220).name.fontSize).toBeGreaterThanOrEqual(24);
  });

  it("sets the note smaller than the name", () => {
    const fit = fitTitle(LONG, 300, 220);
    expect(fit.note!.fontSize).toBeLessThan(fit.name.fontSize);
  });

  it("has no note block when the title has no note", () => {
    expect(fitTitle("Wings of Desire", 300, 220).note).toBeNull();
  });

  it("clamps to the box when even the smallest face overflows", () => {
    const fit = fitTitle(LONG, 90, 60);
    expect(blockHeight(fit)).toBeLessThanOrEqual(60);
    expect(fit.name.maxLines).toBeGreaterThanOrEqual(1);
  });

  it("trims the note before the name when space runs out", () => {
    const fit = fitTitle(LONG, 120, 70);
    expect(fit.name.maxLines).toBeGreaterThanOrEqual(1);
    expect(fit.note!.maxLines).toBeGreaterThanOrEqual(1);
  });

  it("falls back to a readable default before onLayout reports", () => {
    const fit = fitTitle(LONG, 0, 0);
    expect(fit.name.fontSize).toBeGreaterThan(0);
    expect(fit.name.maxLines).toBeGreaterThan(0);
  });
});
