import { describe, it, expect } from "vitest";
import {
  isDraftOrder,
  isDraftRounds,
  pickKey,
  roundForPick,
  seatForPick,
  totalPicks,
} from "./draft";

const orderOf = (order: "snake" | "circle", seats: number, rounds: number) =>
  Array.from({ length: totalPicks(seats, rounds) }, (_, i) => seatForPick(order, seats, i));

describe("seatForPick", () => {
  it("snakes back and forth", () => {
    expect(orderOf("snake", 3, 3)).toEqual([0, 1, 2, 2, 1, 0, 0, 1, 2]);
  });

  it("circles in the same direction every round", () => {
    expect(orderOf("circle", 3, 3)).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2]);
  });

  it("with two seats only differs in who picks twice in a row", () => {
    expect(orderOf("snake", 2, 3)).toEqual([0, 1, 1, 0, 0, 1]);
    expect(orderOf("circle", 2, 3)).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it("gives every seat the same number of picks either way", () => {
    for (const order of ["snake", "circle"] as const) {
      const counts = new Map<number, number>();
      for (const seat of orderOf(order, 4, 5)) counts.set(seat, (counts.get(seat) ?? 0) + 1);
      expect([...counts.values()]).toEqual([5, 5, 5, 5]);
    }
  });
});

describe("roundForPick and totalPicks", () => {
  it("groups picks into rounds of one per seat", () => {
    expect(roundForPick(3, 0)).toBe(0);
    expect(roundForPick(3, 2)).toBe(0);
    expect(roundForPick(3, 3)).toBe(1);
    expect(totalPicks(3, 5)).toBe(15);
  });
});

describe("pickKey", () => {
  it("ignores case and stray whitespace", () => {
    expect(pickKey("  Pepperoni ")).toBe("pepperoni");
    expect(pickKey("Ham   and\tPineapple")).toBe("ham and pineapple");
    expect(pickKey("PEPPERONI")).toBe(pickKey("pepperoni"));
  });

  it("keeps different spellings apart", () => {
    expect(pickKey("Pepperoni")).not.toBe(pickKey("Peperoni"));
  });
});

describe("validators", () => {
  it("accept only the two orders and picks-per-player in range", () => {
    expect(isDraftOrder("snake")).toBe(true);
    expect(isDraftOrder("circle")).toBe(true);
    expect(isDraftOrder("linear")).toBe(false);
    expect(isDraftRounds(1)).toBe(true);
    expect(isDraftRounds(10)).toBe(true);
    expect(isDraftRounds(0)).toBe(false);
    expect(isDraftRounds(11)).toBe(false);
    expect(isDraftRounds(2.5)).toBe(false);
    expect(isDraftRounds("5")).toBe(false);
  });
});
