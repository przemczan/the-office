import type { Role } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  endedStateOf,
  movedReferenceChange,
  movedReferencePlace,
  suggestedReplacement,
} from "./engine-removal-words.ts";

function role(key: string, name: string, title: string, letGoAt: string | null): Role {
  return { key, card: { name, title }, letGoAt } as unknown as Role;
}

const ROLES = [
  role("data-analyst", "Mia", "Data Analyst", null),
  role("reviewer", "Rex", "Reviewer", "2026-11-01T10:00:00.000Z"),
];
const SHOP = { id: "p1", name: "Shop" };

describe("where a removal moves a reference", () => {
  it("names each level", () => {
    expect(movedReferencePlace({ roleKey: null, project: null, work: null }, ROLES)).toBe(
      "The Office default",
    );
    expect(movedReferencePlace({ roleKey: null, project: SHOP, work: null }, ROLES)).toBe(
      "The Project default of Shop",
    );
    expect(movedReferencePlace({ roleKey: "data-analyst", project: SHOP, work: null }, ROLES)).toBe(
      "The Role override of Mia · Data Analyst in Shop",
    );
  });

  it("names a Task's and an Initiative's engine by the record", () => {
    const task = {
      kind: "task" as const,
      id: "t1",
      name: "Export Stats as CSV",
      state: "ready" as const,
    };
    const initiative = {
      kind: "initiative" as const,
      id: "i1",
      name: "Usage reports",
      state: "active" as const,
    };
    expect(movedReferencePlace({ roleKey: null, project: SHOP, work: task }, ROLES)).toBe(
      "The engine of the Task “Export Stats as CSV”",
    );
    expect(movedReferencePlace({ roleKey: null, project: SHOP, work: initiative }, ROLES)).toBe(
      "The engine of the Initiative “Usage reports”",
    );
  });

  it("marks a Task or an Initiative Done or Dropped, and no open one", () => {
    const task = { kind: "task" as const, id: "t1", name: "Export Stats as CSV" };
    const initiative = { kind: "initiative" as const, id: "i1", name: "Usage reports" };
    expect(endedStateOf({ work: { ...task, state: "done" } })).toBe("done");
    expect(endedStateOf({ work: { ...initiative, state: "dropped" } })).toBe("dropped");
    expect(endedStateOf({ work: { ...task, state: "waiting-on-you" } })).toBeNull();
    expect(endedStateOf({ work: { ...initiative, state: "active" } })).toBeNull();
    expect(endedStateOf({ work: null })).toBeNull();
  });

  it("marks a person let go, and falls back to the key for a Role not read", () => {
    expect(movedReferencePlace({ roleKey: "reviewer", project: SHOP, work: null }, ROLES)).toBe(
      "The Role override of Rex · Reviewer (let go) in Shop",
    );
    expect(movedReferencePlace({ roleKey: "planner", project: SHOP, work: null }, undefined)).toBe(
      "The Role override of planner in Shop",
    );
  });
});

function engineName(engineId: string): string {
  return { second: "Second account", "claude-code": "Claude Code" }[engineId] ?? engineId;
}

describe("what a removal moves a reference to", () => {
  it("gives the engine and model on both sides", () => {
    expect(
      movedReferenceChange(
        {
          from: { engineId: "second", model: "claude-haiku-5-5" },
          to: { engineId: "claude-code", model: "claude-haiku-5-5" },
        },
        engineName,
      ),
    ).toBe("Haiku 5.5 on Second account → Haiku 5.5 on Claude Code");
  });

  it("says none when the only engine goes", () => {
    expect(
      movedReferenceChange(
        { from: { engineId: "claude-code", model: "claude-sonnet-5-5" }, to: null },
        engineName,
      ),
    ).toBe("Sonnet 5.5 on Claude Code → none");
  });
});

describe("the replacement suggested", () => {
  const officeDefault = { engineType: "claude-code", engineId: "claude-code" } as const;

  it("is the Office default's engine", () => {
    expect(suggestedReplacement(["second", "claude-code"], "second", officeDefault)).toBe(
      "claude-code",
    );
  });

  it("is the first other engine when the Office default's is the one going", () => {
    expect(
      suggestedReplacement(["claude-code", "second", "third"], "claude-code", officeDefault),
    ).toBe("second");
  });

  it("is none for the only engine", () => {
    expect(suggestedReplacement(["claude-code"], "claude-code", officeDefault)).toBeNull();
  });
});
