import { afterEach, describe, expect, it, vi } from "vitest";
import { createDetailsStore, DETAILS_STORAGE_KEY } from "./details-store.ts";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the Details store", () => {
  it("is off until a choice is kept", () => {
    expect(createDetailsStore().on()).toBe(false);
  });

  it("keeps the choice for this browser", () => {
    createDetailsStore().choose(true);
    expect(createDetailsStore().on()).toBe(true);
    createDetailsStore().choose(false);
    expect(createDetailsStore().on()).toBe(false);
  });

  it("reads a kept choice it can't make sense of as off", () => {
    localStorage.setItem(DETAILS_STORAGE_KEY, "yes");
    expect(createDetailsStore().on()).toBe(false);
  });

  it("is off where storage is blocked, and keeps a choice for the page", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    const store = createDetailsStore();
    expect(store.on()).toBe(false);

    store.choose(true);
    expect(store.on()).toBe(true);
  });

  it("follows a choice made in another tab", () => {
    const store = createDetailsStore();
    const onChange = vi.fn<() => void>();
    store.subscribe(onChange);
    localStorage.setItem(DETAILS_STORAGE_KEY, "true");
    window.dispatchEvent(new StorageEvent("storage", { key: DETAILS_STORAGE_KEY }));
    expect(store.on()).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });
});
