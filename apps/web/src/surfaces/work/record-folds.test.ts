import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecordFoldsStore, RECORD_FOLDS_STORAGE_KEY } from "./record-folds.ts";

const TASK = { kind: "task", id: "task-1" } as const;
const INITIATIVE = { kind: "initiative", id: "task-1" } as const;

describe("a record's folds", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("are kept per record, so a page opened again finds them", () => {
    createRecordFoldsStore().remember(TASK, "plan", true);
    createRecordFoldsStore().remember(INITIATIVE, "plan", false);

    expect(createRecordFoldsStore().remembered()).toEqual({
      "task:task-1": { plan: true },
      "initiative:task-1": { plan: false },
    });
  });

  it("keep the record's other blocks when one is folded", () => {
    const store = createRecordFoldsStore();
    store.remember(TASK, "plan", true);
    store.remember(TASK, "origin", false);

    expect(store.remembered()).toEqual({ "task:task-1": { plan: true, origin: false } });
  });

  it("start empty from what isn't theirs in storage", () => {
    localStorage.setItem(RECORD_FOLDS_STORAGE_KEY, '{"task:task-1":"open"}');
    expect(createRecordFoldsStore().remembered()).toEqual({});
    localStorage.setItem(RECORD_FOLDS_STORAGE_KEY, "not json");
    expect(createRecordFoldsStore().remembered()).toEqual({});
  });

  it("last for the page where storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const store = createRecordFoldsStore();
    store.remember(TASK, "plan", true);

    expect(store.remembered()).toEqual({ "task:task-1": { plan: true } });
  });

  it("tell whoever listens", () => {
    const store = createRecordFoldsStore();
    const onChange = vi.fn<() => void>();
    const stopListening = store.subscribe(onChange);
    store.remember(TASK, "plan", true);
    stopListening();
    store.remember(TASK, "plan", false);

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
