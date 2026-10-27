import type { MemoryNote } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { memoryGroups } from "./memory-groups.ts";

const note = (id: string, projectId?: string): MemoryNote => ({
  id,
  projectId,
  text: id,
  source: { kind: "user" },
  writtenAt: "2026-10-27T09:00:00.000Z",
});

const PROJECTS = [
  { id: "admin-panel", name: "Admin panel" },
  { id: "billing", name: "Billing" },
];

describe("memoryGroups", () => {
  it("lists the notes for all Projects first, then each Project's, newest first within each", () => {
    const groups = memoryGroups(
      [note("a", "billing"), note("b"), note("c", "admin-panel"), note("d", "billing")],
      PROJECTS,
    );

    expect(groups.map(({ title, notes }) => [title, notes.map(({ id }) => id)])).toEqual([
      ["All Projects", ["b"]],
      ["Admin panel", ["c"]],
      ["Billing", ["a", "d"]],
    ]);
  });

  it("leaves out a group with no notes and names a gone Project by its id", () => {
    const groups = memoryGroups([note("a", "retired")], PROJECTS);

    expect(groups).toEqual([
      { projectId: "retired", title: "retired", notes: [note("a", "retired")] },
    ]);
  });
});
