import { describe, expect, it } from "vitest";
import { threadTabs, withTabShown } from "./thread-tabs.ts";

describe("threadTabs", () => {
  it("shows the newest of the first Threads seen, in their order", () => {
    expect(threadTabs(undefined, ["c", "b", "a"])).toEqual({
      order: ["c", "b", "a"],
      shownId: "c",
      fresh: new Set(),
    });
  });

  it("shows the Thread asked for first when it is one of them", () => {
    expect(threadTabs(undefined, ["c", "b", "a"], "b").shownId).toBe("b");
    expect(threadTabs(undefined, ["c", "b", "a"], "z").shownId).toBe("c");
  });

  it("adds a new Thread right after the shown tab, marked new, without showing it", () => {
    const opened = withTabShown(threadTabs(undefined, ["c", "b", "a"]), "b");
    const tabs = threadTabs(opened, ["d", "c", "b", "a"]);
    expect(tabs.order).toEqual(["c", "b", "d", "a"]);
    expect(tabs.shownId).toBe("b");
    expect(tabs.fresh).toEqual(new Set(["d"]));
  });

  it("takes the first Thread of a record that had none as its first, not as new", () => {
    const empty = threadTabs(undefined, []);
    expect(threadTabs(empty, [])).toBe(empty);
    expect(threadTabs(empty, ["a"])).toEqual({ order: ["a"], shownId: "a", fresh: new Set() });
  });

  it("gives the same tabs back while no Thread is added", () => {
    const tabs = threadTabs(undefined, ["b", "a"]);
    expect(threadTabs(tabs, ["b", "a"])).toBe(tabs);
  });

  it("no longer marks a tab new once it is shown", () => {
    const tabs = threadTabs(threadTabs(undefined, ["a"]), ["b", "a"]);
    expect(withTabShown(tabs, "b")).toEqual({
      order: ["a", "b"],
      shownId: "b",
      fresh: new Set(),
    });
  });
});
