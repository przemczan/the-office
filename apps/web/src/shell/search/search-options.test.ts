import type { Role, SearchResults } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  matchesInOtherProjects,
  peopleMatching,
  searchGroups,
  searchWords,
} from "./search-options.ts";

const ADA = person("developer", "Ada", "Developer", null);
const BORYS = person("designer", "Borys", "Product Designer", null);
const LET_GO = person("tester", "Ada", "Tester", "2026-10-01T00:00:00.000Z");

describe("searchWords", () => {
  it("reads letters and digits only, lower-cased, each once, as the service does", () => {
    expect(searchWords("UI-polish & !(v2):* ui")).toEqual(["ui", "polish", "v2"]);
    expect(searchWords(" & ")).toEqual([]);
  });
});

describe("peopleMatching", () => {
  it("finds the people hired by the start of each word of their name or title", () => {
    expect(peopleMatching([ADA, BORYS, LET_GO], ["ad"])).toEqual([ADA]);
    expect(peopleMatching([ADA, BORYS], ["prod", "des"])).toEqual([BORYS]);
    expect(peopleMatching([ADA, BORYS], ["ad", "des"])).toEqual([]);
  });

  it("finds nobody for no words", () => {
    expect(peopleMatching([ADA], [])).toEqual([]);
  });
});

describe("searchGroups", () => {
  it("lists Tasks, Initiatives, Ideas, people and documents in that order, leaving out the empty", () => {
    const groups = searchGroups(
      {
        ...NOTHING,
        tasks: [{ id: "t", title: "Fix login", state: "backlog", projectIds: ["web"] }],
        attachments: [
          { id: "d", name: "brief.md", owner: { kind: "task", taskId: "t" }, projectIds: [] },
        ],
      },
      [ADA],
    );

    expect(groups.map(({ heading }) => heading)).toEqual(["Tasks", "People", "Documents"]);
    expect(groups[1]?.options).toEqual([
      {
        key: "person-developer",
        label: "Ada · Developer",
        projectIds: [],
        pick: { kind: "person", roleKey: "developer" },
      },
    ]);
    expect(groups[2]?.options[0]?.pick).toEqual({ kind: "document", id: "d", name: "brief.md" });
  });
});

describe("matchesInOtherProjects", () => {
  it("adds up every kind", () => {
    const results = {
      ...NOTHING,
      inOtherProjects: { tasks: 2, ideas: 1, initiatives: 0, attachments: 3 },
    };
    expect(matchesInOtherProjects(results)).toBe(6);
    expect(matchesInOtherProjects(undefined)).toBe(0);
  });
});

const NOTHING: SearchResults = {
  tasks: [],
  ideas: [],
  initiatives: [],
  attachments: [],
  inOtherProjects: { tasks: 0, ideas: 0, initiatives: 0, attachments: 0 },
};

function person(key: string, name: string, title: string, letGoAt: string | null): Role {
  return { key, letGoAt, card: { name, title } } as unknown as Role;
}
