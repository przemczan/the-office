import { describe, expect, it } from "vitest";
import { hasEnded, processFromStat } from "./linux-processes.js";

describe("processFromStat", () => {
  it("reads the state and the group after the name, which may hold spaces and parentheses", () => {
    expect(processFromStat(42, "42 (node (dev) server) S 1 40 40 0 -1 4194560 120")).toEqual({
      processId: 42,
      state: "S",
      groupId: 40,
    });
  });

  it("gives nothing for a line it can't read", () => {
    expect(processFromStat(42, "42 (node)")).toBeUndefined();
  });
});

describe("hasEnded", () => {
  it.each([
    ["Z", true],
    ["X", true],
    ["S", false],
    ["R", false],
    ["D", false],
  ])("says a process in state %s has ended: %s", (state, ended) => {
    expect(hasEnded(state)).toBe(ended);
  });
});
