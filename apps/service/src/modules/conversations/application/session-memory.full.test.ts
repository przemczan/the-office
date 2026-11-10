import { describe, expect, it } from "vitest";
import type { MemoryService } from "../../people/index.js";
import { SessionMemory } from "./session-memory.js";

type Memory = Awaited<ReturnType<MemoryService["read"]>>;

const NOTES: Memory["notes"] = [
  {
    id: "n-1",
    roleKey: "planner",
    projectId: undefined,
    text: "Prefers short answers.",
    source: { kind: "user" },
    writtenAt: new Date("2026-10-10T09:00:00.000Z"),
  },
];

function sessionMemoryOf(memory: Memory): SessionMemory {
  return new SessionMemory({ read: () => Promise.resolve(memory) } as unknown as MemoryService);
}

describe("SessionMemory", () => {
  it("reads the notes of a person whose Shared memory is on", async () => {
    const memory = await sessionMemoryOf({ inUse: true, notes: NOTES }).forBrief("planner", {
      kind: "all-projects",
    });

    expect(memory.lines).toEqual(["- 2026-10-10: Prefers short answers."]);
  });

  it("reads none while Shared memory is off: the notes are kept, not read", async () => {
    const memory = await sessionMemoryOf({ inUse: false, notes: NOTES }).forBrief("planner", {
      kind: "all-projects",
    });

    expect(memory).toEqual({ lines: [], leftOut: 0 });
  });
});
