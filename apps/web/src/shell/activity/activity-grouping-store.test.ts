import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_GROUPING_STORAGE_KEY,
  createActivityGroupingStore,
} from "./activity-grouping-store.ts";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("the Activity grouping", () => {
  it("is By person until another is chosen", () => {
    expect(createActivityGroupingStore().current()).toBe("person");
  });

  it("is kept in this browser, so a reload finds it", () => {
    createActivityGroupingStore().remember("subject");

    expect(localStorage.getItem(ACTIVITY_GROUPING_STORAGE_KEY)).toBe('"subject"');
    expect(createActivityGroupingStore().current()).toBe("subject");
  });

  it("falls back to By person when what is stored is not a grouping", () => {
    localStorage.setItem(ACTIVITY_GROUPING_STORAGE_KEY, '"nonsense"');

    expect(createActivityGroupingStore().current()).toBe("person");
  });

  it("lasts for the page when storage is blocked, and tells its listeners", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const store = createActivityGroupingStore();
    const onChange = vi.fn<() => void>();
    store.subscribe(onChange);

    store.remember("subject");

    expect(store.current()).toBe("subject");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("follows another tab's choice", () => {
    const store = createActivityGroupingStore();
    store.subscribe(() => undefined);

    localStorage.setItem(ACTIVITY_GROUPING_STORAGE_KEY, '"subject"');
    window.dispatchEvent(new StorageEvent("storage", { key: ACTIVITY_GROUPING_STORAGE_KEY }));

    expect(store.current()).toBe("subject");
  });
});
