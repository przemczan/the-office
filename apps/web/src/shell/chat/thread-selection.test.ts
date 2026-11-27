import type { ThreadSummary } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  NOTHING_PICKED,
  pickedAmong,
  pickedMark,
  pressAll,
  pressRow,
  type ThreadSelection,
} from "./thread-selection.ts";

function thread(id: string, locked = false): ThreadSummary {
  return { id, deletionLock: locked ? "open-call" : null } as ThreadSummary;
}

const THREADS = [thread("a"), thread("b"), thread("c", true), thread("d"), thread("e")];

function pressed(selection: ThreadSelection, id: string, shift = false): ThreadSelection {
  return pressRow(selection, THREADS, id, shift);
}

describe("the Thread list's selection", () => {
  it("a press picks a row and the next press on it clears it", () => {
    const picked = pressed(NOTHING_PICKED, "a");
    expect([...picked.picked]).toEqual(["a"]);

    expect(pressed(picked, "a").picked.size).toBe(0);
  });

  it("a locked row can't be picked", () => {
    expect(pressed(NOTHING_PICKED, "c")).toBe(NOTHING_PICKED);
  });

  it("Shift picks the run from the row pressed last, leaving a locked row out", () => {
    const run = pressed(pressed(NOTHING_PICKED, "a"), "e", true);

    expect([...run.picked].toSorted()).toEqual(["a", "b", "d", "e"]);
  });

  it("Shift on a picked row clears the run, backwards too", () => {
    const all = pressAll(NOTHING_PICKED, THREADS);
    const anchored = pressed(pressed(all, "d"), "b", true);

    expect([...anchored.picked].toSorted()).toEqual(["a", "e"]);
  });

  it("Shift with no row pressed before picks just that row", () => {
    expect([...pressed(NOTHING_PICKED, "d", true).picked]).toEqual(["d"]);
  });

  it("the bar's box is empty, mixed or full by the Threads that can be picked", () => {
    expect(pickedMark(NOTHING_PICKED, THREADS)).toBe(false);
    expect(pickedMark(pressed(NOTHING_PICKED, "a"), THREADS)).toBe("mixed");
    expect(pickedMark(pressAll(NOTHING_PICKED, THREADS), THREADS)).toBe(true);
  });

  it("pressing the bar's box picks them all, then none", () => {
    const all = pressAll(NOTHING_PICKED, THREADS);
    expect(all.picked.size).toBe(4);

    expect(pressAll(all, THREADS).picked.size).toBe(0);
    expect(pressAll(pressed(NOTHING_PICKED, "a"), THREADS).picked.size).toBe(4);
  });

  it("a Thread deleted elsewhere drops out of what is picked", () => {
    const all = pressAll(NOTHING_PICKED, THREADS);

    expect(pickedAmong(all, THREADS.slice(1)).map(({ id }) => id)).toEqual(["b", "d", "e"]);
  });
});
