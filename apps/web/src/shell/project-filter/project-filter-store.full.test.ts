import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectFilterStore, PROJECT_FILTER_STORAGE_KEY } from "./project-filter-store.ts";

afterEach(() => localStorage.clear());

describe("the Project filter's store", () => {
  it("shows All projects until a choice is kept", () => {
    expect(createProjectFilterStore().current()).toBe("all");
  });

  it("keeps the choice for this browser", () => {
    createProjectFilterStore().choose(["web"]);
    expect(createProjectFilterStore().current()).toEqual(["web"]);
  });

  it("reads a kept choice it can't make sense of as All projects", () => {
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, "[]");
    expect(createProjectFilterStore().current()).toBe("all");
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, "not JSON");
    expect(createProjectFilterStore().current()).toBe("all");
  });

  it("follows a choice made in another tab", () => {
    const store = createProjectFilterStore();
    const onChange = vi.fn<() => void>();
    store.subscribe(onChange);
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, JSON.stringify(["mobile"]));
    window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    expect(store.current()).toEqual(["mobile"]);
    expect(onChange).toHaveBeenCalled();
  });
});
