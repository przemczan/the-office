import { describe, expect, it } from "vitest";
import { MEMORY_NOTE_LENGTH, writeMemoryNote } from "./memory-note.js";
import { RoleRefused } from "./role-refused.js";
import { ANN_LEE } from "./user.fixtures.js";

const writtenAt = new Date("2026-10-27T10:00:00.000Z");

describe("writeMemoryNote", () => {
  it("keeps the text without its surrounding spaces, with its source and date", () => {
    const note = writeMemoryNote(
      {
        roleKey: "planner",
        projectId: "p1",
        text: " Prefers small PRs.\n",
        source: { kind: "user", user: ANN_LEE },
      },
      "note-1",
      writtenAt,
    );

    expect(note).toEqual({
      id: "note-1",
      roleKey: "planner",
      projectId: "p1",
      text: "Prefers small PRs.",
      source: { kind: "user", user: ANN_LEE },
      writtenAt,
    });
  });

  it("refuses an empty note", () => {
    const draft = {
      roleKey: "planner",
      projectId: undefined,
      text: "  ",
      source: { kind: "user", user: ANN_LEE },
    } as const;

    expect(() => writeMemoryNote(draft, "note-1", writtenAt)).toThrow(RoleRefused);
  });

  it("refuses a note over the length limit", () => {
    const draft = {
      roleKey: "planner",
      projectId: undefined,
      text: "x".repeat(MEMORY_NOTE_LENGTH + 1),
      source: { kind: "user", user: ANN_LEE },
    } as const;

    expect(() => writeMemoryNote(draft, "note-1", writtenAt)).toThrow(
      `Keep a note to ${MEMORY_NOTE_LENGTH} characters or fewer.`,
    );
  });
});
