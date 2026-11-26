import { describe, expect, it } from "vitest";
import {
  isOffered,
  officeToolCallWords,
  offeredTools,
  toolRuling,
  valueOnSubject,
} from "./office-tool-ruling.js";
import { canonicalJson } from "../../engine/index.js";
import type { AuthorityGroup, AuthorityInEffect, AuthoritySetting } from "../../people/index.js";

const ALLOWED = { kind: "allowed" } as const;
const NEVER = { kind: "never" } as const;
const ASK_ME = { kind: "ask-me" } as const;
const PROPOSAL = { kind: "proposal" } as const;
const CONSULT_CTO = { kind: "consult", role: "cto" } as const;

describe("canonicalJson", () => {
  it("sorts every object's keys and leaves out whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[{"y":2,"z":1}]},"b":1}',
    );
  });

  it("reads the same call with its keys in another order the same, and a changed input another", () => {
    const first = officeToolCallWords("change_task_title", { taskId: "t1", title: "New" });
    const reordered = officeToolCallWords("change_task_title", { title: "New", taskId: "t1" });
    expect(reordered).toBe(first);
    expect(officeToolCallWords("change_task_title", { taskId: "t1", title: "Other" })).not.toBe(
      first,
    );
    expect(officeToolCallWords("drop_task", { taskId: "t1", title: "New" })).not.toBe(first);
  });

  it("leaves out an undefined field, as JSON does", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("valueOnSubject", () => {
  const split: AuthoritySetting = { kind: "own-and-others", own: ALLOWED, others: ASK_ME };

  it("takes the own value for the person's own work and the others' value for the rest", () => {
    expect(valueOnSubject(split, true)).toEqual(ALLOWED);
    expect(valueOnSubject(split, false)).toEqual(ASK_ME);
  });

  it("takes a row's one value whoever's work it is", () => {
    expect(valueOnSubject(CONSULT_CTO, true)).toEqual(CONSULT_CTO);
    expect(valueOnSubject(CONSULT_CTO, false)).toEqual(CONSULT_CTO);
  });
});

describe("toolRuling", () => {
  it("runs an Allowed call", () => {
    expect(toolRuling(ALLOWED, false)).toEqual({ kind: "run" });
  });

  it("holds a Consult call for the person", () => {
    expect(toolRuling(CONSULT_CTO, false)).toEqual({ kind: "hold", setting: CONSULT_CTO });
  });

  it("holds an Ask me call, and drafts a Proposal call", () => {
    expect(toolRuling(ASK_ME, false)).toEqual({ kind: "hold", setting: ASK_ME });
    expect(toolRuling(PROPOSAL, false)).toEqual({ kind: "propose" });
  });

  it("leaves a Never call out, unless the person holds a duty that grants the tool", () => {
    expect(toolRuling(NEVER, false)).toEqual({ kind: "never" });
    expect(toolRuling(NEVER, true)).toEqual({ kind: "run" });
  });
});

describe("isOffered", () => {
  it("offers a tool unless it is Never on every subject", () => {
    expect(isOffered(NEVER)).toBe(false);
    expect(isOffered({ kind: "own-and-others", own: NEVER, others: NEVER })).toBe(false);
    expect(isOffered({ kind: "own-and-others", own: ALLOWED, others: NEVER })).toBe(true);
    expect(isOffered(PROPOSAL)).toBe(true);
  });
});

describe("offeredTools", () => {
  const authority = {
    taskRecords: NEVER,
    movingWork: ALLOWED,
    initiativeRecords: NEVER,
  } as unknown as AuthorityInEffect;
  const groupOf = new Map<string, AuthorityGroup>([
    ["change_task_title", "taskRecords"],
    ["move_task", "movingWork"],
    ["add_dependency", "initiativeRecords"],
  ]);

  it("leaves out an Office action's tool ruled Never and keeps every other tool", () => {
    expect(
      offeredTools(["open_decision", "change_task_title", "move_task"], groupOf, authority, []),
    ).toEqual(["open_decision", "move_task"]);
  });

  it("keeps a duty's tool offered to the duty's holder where the row says Never", () => {
    expect(offeredTools(["add_dependency"], groupOf, authority, ["shapes-initiatives"])).toEqual([
      "add_dependency",
    ]);
    expect(offeredTools(["add_dependency"], groupOf, authority, [])).toEqual([]);
  });
});
