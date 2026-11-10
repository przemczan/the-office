import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOARD_GROUP_FOLDS_STORAGE_KEY,
  createBoardGroupFoldsStore,
  startsOpen,
} from "./board-group-folds.ts";

describe("the board's group folds", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("are kept per group, so the board opened again finds them", () => {
    createBoardGroupFoldsStore().remember(["pairing"], false);
    createBoardGroupFoldsStore().remember(["none"], true);

    expect(createBoardGroupFoldsStore().remembered()).toEqual({ pairing: false, none: true });
  });

  it("fold or unfold several groups at once, keeping the others", () => {
    const store = createBoardGroupFoldsStore();
    store.remember(["sync"], true);
    store.remember(["pairing", "none"], false);

    expect(store.remembered()).toEqual({ sync: true, pairing: false, none: false });
  });

  it("start empty from what isn't theirs in storage", () => {
    localStorage.setItem(BOARD_GROUP_FOLDS_STORAGE_KEY, '{"pairing":"open"}');
    expect(createBoardGroupFoldsStore().remembered()).toEqual({});
    localStorage.setItem(BOARD_GROUP_FOLDS_STORAGE_KEY, "not json");
    expect(createBoardGroupFoldsStore().remembered()).toEqual({});
  });

  it("last for the page where storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const store = createBoardGroupFoldsStore();
    store.remember(["pairing"], false);

    expect(store.remembered()).toEqual({ pairing: false });
  });

  it("tell whoever listens", () => {
    const store = createBoardGroupFoldsStore();
    const onChange = vi.fn<() => void>();
    const stopListening = store.subscribe(onChange);
    store.remember(["pairing"], false);
    stopListening();
    store.remember(["pairing"], true);

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("startsOpen", () => {
  it("folds a Done or Dropped Initiative's group until the user unfolds it", () => {
    expect(startsOpen({ initiative: { state: "done" } })).toBe(false);
    expect(startsOpen({ initiative: { state: "dropped" } })).toBe(false);
    expect(startsOpen({ initiative: { state: "active" } })).toBe(true);
    expect(startsOpen({ initiative: undefined })).toBe(true);
  });
});
