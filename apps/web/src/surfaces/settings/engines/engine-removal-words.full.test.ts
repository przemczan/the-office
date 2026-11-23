import { describe, expect, it } from "vitest";
import {
  endedStateOf,
  movedReferenceChange,
  movedReferencePlace,
  removalTypeNotes,
  suggestedReplacement,
} from "./engine-removal-words.ts";

const SHOP = { id: "p1", name: "Shop" };

describe("where a removal moves a reference", () => {
  it("names each level", () => {
    expect(movedReferencePlace({ project: null, work: null })).toBe("The Office default");
    expect(movedReferencePlace({ project: SHOP, work: null })).toBe("The Project default of Shop");
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
    expect(movedReferencePlace({ project: SHOP, work: task })).toBe(
      "The engine override of the Task “Export Stats as CSV”",
    );
    expect(movedReferencePlace({ project: SHOP, work: initiative })).toBe(
      "The engine override of the Initiative “Usage reports”",
    );
  });

  it("names the Office's Stand-in Engine list and a Project's own", () => {
    expect(movedReferencePlace({ project: null, work: null, standInList: true })).toBe(
      "The Office's Stand-in Engine list",
    );
    expect(movedReferencePlace({ project: SHOP, work: null, standInList: true })).toBe(
      "The Stand-in Engine list of Shop",
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
});

function engineName(engineId: string): string {
  return { second: "Second account", "claude-code": "Claude Code" }[engineId] ?? engineId;
}

describe("what a removal moves a reference to", () => {
  it("gives the engines alone, as no level names a model", () => {
    expect(movedReferenceChange({ from: "second", to: "claude-code" }, engineName)).toBe(
      "Second account → Claude Code",
    );
  });

  it("says none when the only engine goes, or a list already names the replacement", () => {
    expect(movedReferenceChange({ from: "claude-code", to: null }, engineName)).toBe(
      "Claude Code → none",
    );
  });
});

const CLAUDE_CODE = { id: "claude-code", kind: "claude-code", name: "Claude Code" } as const;
const SECOND = { id: "second", kind: "claude-code", name: "Second account" } as const;
const CODEX = { id: "codex", kind: "codex", name: "Codex" } as const;

describe("the replacement suggested", () => {
  const officeDefault = { engineId: "codex" };

  it("is the first other engine of the removed one's type", () => {
    expect(suggestedReplacement([CODEX, CLAUDE_CODE, SECOND], "claude-code", officeDefault)).toBe(
      "second",
    );
  });

  it("is the Office default's engine when no other engine is of its type", () => {
    expect(suggestedReplacement([CLAUDE_CODE, CODEX], "claude-code", officeDefault)).toBe("codex");
  });

  it("is the first other engine when the Office default's is the one going", () => {
    expect(suggestedReplacement([CODEX, CLAUDE_CODE], "codex", officeDefault)).toBe("claude-code");
  });

  it("is none for the only engine", () => {
    expect(suggestedReplacement([CODEX], "codex", officeDefault)).toBeNull();
  });
});

describe("the notes on the engine type", () => {
  it("says nothing for a replacement of the same type, the type keeping an engine", () => {
    expect(removalTypeNotes([CLAUDE_CODE, SECOND], "claude-code", "second")).toEqual([]);
  });

  it("says a replacement of another type takes its type to the defaults it takes over, and the type's last engine leaves its settings unused", () => {
    expect(removalTypeNotes([CLAUDE_CODE, CODEX], "claude-code", "codex")).toEqual([
      "Codex is of another engine type, Codex: the Office default and the Project defaults it takes over take its type with it, and each person works there with their model and effort for it.",
      "Claude Code is the last Claude Code engine: people's and Projects' settings for Claude Code are kept, unused until a Claude Code engine is listed again.",
    ]);
  });

  it("says the type's last engine leaves its settings unused when the only engine goes", () => {
    expect(removalTypeNotes([CODEX], "codex", null)).toEqual([
      "Codex is the last Codex engine: people's and Projects' settings for Codex are kept, unused until a Codex engine is listed again.",
    ]);
  });
});
