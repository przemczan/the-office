import { afterEach, describe, expect, it, vi } from "vitest";
import { createDroppedFoldStore, DROPPED_FOLD_STORAGE_KEY } from "./dropped-fold.ts";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the Dropped fold's memory", () => {
  it("is folded until the user opens it", () => {
    expect(createDroppedFoldStore().open()).toBe(false);
  });

  it("is remembered in this browser under its own key", () => {
    createDroppedFoldStore().remember(true);
    expect(localStorage.getItem(DROPPED_FOLD_STORAGE_KEY)).toBe("true");
    expect(createDroppedFoldStore().open()).toBe(true);
    createDroppedFoldStore().remember(false);
    expect(createDroppedFoldStore().open()).toBe(false);
  });

  it("reads a kept value it can't make sense of as folded", () => {
    localStorage.setItem(DROPPED_FOLD_STORAGE_KEY, "open");
    expect(createDroppedFoldStore().open()).toBe(false);
  });

  it("is folded where storage is blocked, and keeps a choice for the page", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    const store = createDroppedFoldStore();
    expect(store.open()).toBe(false);

    store.remember(true);
    expect(store.open()).toBe(true);
  });

  it("follows the fold opened in another tab", () => {
    const store = createDroppedFoldStore();
    const onChange = vi.fn<() => void>();
    store.subscribe(onChange);
    localStorage.setItem(DROPPED_FOLD_STORAGE_KEY, "true");
    window.dispatchEvent(new StorageEvent("storage", { key: DROPPED_FOLD_STORAGE_KEY }));
    expect(store.open()).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });
});
