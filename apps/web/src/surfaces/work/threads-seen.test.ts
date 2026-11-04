import { describe, expect, it } from "vitest";
import { threadsSeen, withThreadSeen } from "./threads-seen.ts";

describe("threadsSeen", () => {
  it("shows the newest of the first Threads seen", () => {
    expect(threadsSeen(undefined, ["c", "b", "a"])).toEqual({
      known: ["c", "b", "a"],
      shownId: "c",
      fresh: new Set(),
    });
  });

  it("shows the Thread asked for first when it is one of them", () => {
    expect(threadsSeen(undefined, ["c", "b", "a"], "b").shownId).toBe("b");
    expect(threadsSeen(undefined, ["c", "b", "a"], "z").shownId).toBe("c");
  });

  it("marks a Thread added later new, without showing it", () => {
    const seen = threadsSeen(threadsSeen(undefined, ["c", "b", "a"]), ["d", "c", "b", "a"]);
    expect(seen.shownId).toBe("c");
    expect(seen.fresh).toEqual(new Set(["d"]));
  });

  it("takes the first Thread of a record that had none as its first, not as new", () => {
    const empty = threadsSeen(undefined, []);
    expect(threadsSeen(empty, [])).toBe(empty);
    expect(threadsSeen(empty, ["a"])).toEqual({ known: ["a"], shownId: "a", fresh: new Set() });
  });

  it("shows the Thread a link on the page changes the address to, and only on the change", () => {
    const seen = threadsSeen(undefined, ["c", "b", "a"], "c");
    const followed = threadsSeen(seen, ["c", "b", "a"], "a");
    expect(followed.shownId).toBe("a");
    expect(threadsSeen(followed, ["c", "b", "a"], "a")).toBe(followed);
  });

  it("no longer marks new a Thread a link shows", () => {
    const seen = threadsSeen(threadsSeen(undefined, ["a"]), ["b", "a"]);
    expect(threadsSeen(seen, ["b", "a"], "b").fresh).toEqual(new Set());
  });

  it("stays where it is when the address asks for a Thread not among them", () => {
    const seen = threadsSeen(undefined, ["b", "a"]);
    expect(threadsSeen(seen, ["b", "a"], "gone").shownId).toBe("b");
  });

  it("gives the same back while no Thread is added", () => {
    const seen = threadsSeen(undefined, ["b", "a"]);
    expect(threadsSeen(seen, ["b", "a"])).toBe(seen);
  });
});

describe("withThreadSeen", () => {
  it("no longer marks the Thread new", () => {
    const seen = threadsSeen(threadsSeen(undefined, ["a"]), ["b", "a"]);
    expect(withThreadSeen(seen, "b").fresh).toEqual(new Set());
  });
});
