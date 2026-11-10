import { afterEach, describe, expect, it, vi } from "vitest";
import { createRailStore, RAIL_EXPANDED_STORAGE_KEY } from "./rail-store.ts";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the rail's store", () => {
  it("shows the icon rail until a choice is kept", () => {
    expect(createRailStore().expanded()).toBe(false);
  });

  it("keeps the choice for this browser", () => {
    createRailStore().choose(true);
    expect(createRailStore().expanded()).toBe(true);
    createRailStore().choose(false);
    expect(createRailStore().expanded()).toBe(false);
  });

  it("reads a kept choice it can't make sense of as the icon rail", () => {
    localStorage.setItem(RAIL_EXPANDED_STORAGE_KEY, "yes");
    expect(createRailStore().expanded()).toBe(false);
  });

  it("shows the icon rail where storage is blocked, and keeps a choice for the page", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    const store = createRailStore();
    expect(store.expanded()).toBe(false);

    store.choose(true);
    expect(store.expanded()).toBe(true);
  });

  it("follows a choice made in another tab", () => {
    const store = createRailStore();
    const onChange = vi.fn<() => void>();
    store.subscribe(onChange);
    localStorage.setItem(RAIL_EXPANDED_STORAGE_KEY, "true");
    window.dispatchEvent(new StorageEvent("storage", { key: RAIL_EXPANDED_STORAGE_KEY }));
    expect(store.expanded()).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });
});
