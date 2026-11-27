import type { AuthorityInEffect, Role } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { AUTHORITY_AREAS, NEVER_EVERYWHERE } from "../../shell/authority.fixtures.ts";
import {
  areasWhereTheyDiffer,
  authorityColumns,
  changedCards,
  isChanged,
  settingInEffect,
  valueCounts,
  valueCountWords,
} from "./authority-table.ts";

const TITLES = new Map([["devops", "Devops"]]);

function person(key: string, more: Partial<Role> = {}): Role {
  return {
    key,
    card: { name: key, authority: {} },
    presetAuthority: NEVER_EVERYWHERE,
    builtIn: false,
    letGoAt: null,
    ...more,
  } as unknown as Role;
}

const CARETAKER = person("caretaker", { builtIn: true });
const ADA = person("ada", {
  card: { name: "ada", authority: { movingWork: { kind: "allowed" } } },
} as Partial<Role>);
const BOB = person("bob", {
  presetAuthority: { ...NEVER_EVERYWHERE, movingWork: { kind: "ask-me" } } as AuthorityInEffect,
});
const LET_GO = person("zed", { letGoAt: "2026-11-01T00:00:00.000Z" });

describe("the Authority table", () => {
  it("has a column for everyone not let go, the Caretaker first", () => {
    expect(authorityColumns([ADA, LET_GO, CARETAKER, BOB]).map(({ key }) => key)).toEqual([
      "caretaker",
      "ada",
      "bob",
    ]);
  });

  it("counts the people on each value, the most common first, a pair as its own value", () => {
    const people = [CARETAKER, ADA, BOB, person("cy")];
    const edits = new Map();

    expect(valueCountWords(valueCounts(people, "movingWork", edits), TITLES)).toBe(
      "Never 2 · Allowed 1 · Ask me 1",
    );
    const pair = {
      kind: "own-and-others",
      own: { kind: "allowed" },
      others: { kind: "never" },
    } as const;
    const withPair = person("dee", { presetAuthority: { ...NEVER_EVERYWHERE, taskRecords: pair } });
    expect(valueCountWords(valueCounts([withPair, ADA], "taskRecords", edits), TITLES)).toBe(
      "Own: Allowed · Others': Never 1 · Never 1",
    );
  });

  it("keeps only the rows where people differ, and drops the areas left empty", () => {
    const areas = areasWhereTheyDiffer(AUTHORITY_AREAS, [CARETAKER, ADA], new Map());

    expect(areas.map(({ label, rows }) => [label, rows.map(({ group }) => group)])).toEqual([
      ["Work", ["movingWork"]],
    ]);
  });

  it("reads the setting in effect with the edit made to it, and marks a changed cell", () => {
    const edits = new Map([["ada", { movingWork: { kind: "never" } } as const]]);

    expect(settingInEffect(ADA, "movingWork", edits)).toEqual({ kind: "never" });
    expect(isChanged(ADA, "movingWork", edits)).toBe(true);
    expect(isChanged(BOB, "movingWork", edits)).toBe(false);
  });

  it("gives each changed person's card with only the Authority replaced", () => {
    const edits = new Map([
      ["ada", { movingWork: { kind: "never" } } as const],
      ["bob", {}],
    ]);

    const changed = changedCards([ADA, BOB], edits);

    expect(changed.map(({ role }) => role.key)).toEqual(["ada"]);
    expect(changed[0]?.card).toEqual({
      name: "ada",
      authority: { movingWork: { kind: "never" } },
    });
  });
});
