import { afterEach, describe, expect, it, vi } from "vitest";
import { boardFiltersOf } from "./board-filters.ts";
import {
  BOARD_GROUPING_STORAGE_KEY,
  boardGroupingOf,
  createBoardGroupingStore,
} from "./board-grouping.ts";

describe("boardGroupingOf", () => {
  it("reads ?group=initiative, apart from the filters", () => {
    const search = { group: "initiative", priority: "high" };

    expect(boardGroupingOf(search)).toEqual({ group: "initiative" });
    expect(boardFiltersOf(search)).toEqual({ priority: "high" });
  });

  it("leaves out any other value", () => {
    expect(boardGroupingOf({})).toEqual({});
    expect(boardGroupingOf({ group: "project" })).toEqual({});
    expect(boardGroupingOf({ group: true })).toEqual({});
  });
});

describe("the board's remembered grouping", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("is off until the user groups the board", () => {
    expect(createBoardGroupingStore().current()).toBe(false);
  });

  it("is kept, on and off, so the board opened again finds it", () => {
    createBoardGroupingStore().remember(true);
    expect(createBoardGroupingStore().current()).toBe(true);

    createBoardGroupingStore().remember(false);
    expect(createBoardGroupingStore().current()).toBe(false);
  });

  it("reads as off from what isn't its own in storage", () => {
    localStorage.setItem(BOARD_GROUPING_STORAGE_KEY, '{"grouped":"yes"}');
    expect(createBoardGroupingStore().current()).toBe(false);
    localStorage.setItem(BOARD_GROUPING_STORAGE_KEY, "not json");
    expect(createBoardGroupingStore().current()).toBe(false);
  });

  it("lasts for the page where storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const store = createBoardGroupingStore();
    store.remember(true);

    expect(store.current()).toBe(true);
  });

  it("follows another tab's choice", () => {
    const store = createBoardGroupingStore();
    const onChange = vi.fn<() => void>();
    const stopListening = store.subscribe(onChange);
    localStorage.setItem(BOARD_GROUPING_STORAGE_KEY, '{"grouped":true}');
    window.dispatchEvent(new StorageEvent("storage", { key: BOARD_GROUPING_STORAGE_KEY }));
    stopListening();

    expect(store.current()).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
