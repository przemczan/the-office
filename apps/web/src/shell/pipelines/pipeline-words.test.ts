import type { Role, Stage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { stageChanges, stageFieldChanges, stagesLine } from "./pipeline-words.ts";

const LOOK: Stage = { kind: "gate", key: "look", name: "Look", optional: false };
const PUBLISH: Stage = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
};

describe("stagesLine", () => {
  it("joins the Stages' names in order", () => {
    expect(stagesLine({ stages: [LOOK, PUBLISH] })).toBe("Look → Publish");
  });
});

describe("stageChanges", () => {
  it("names the Stages added, rewritten and removed, by key", () => {
    const lint: Stage = {
      kind: "script",
      key: "lint",
      name: "Lint",
      optional: false,
      command: "lint",
    };

    expect(stageChanges([LOOK, PUBLISH], [lint, { ...PUBLISH, optional: true }])).toEqual([
      { name: "Lint", change: "added" },
      { name: "Publish", change: "changed" },
      { name: "Look", change: "removed" },
    ]);
  });

  it("finds nothing changed in Stages alike, whatever order their fields came in", () => {
    const reordered = { optional: false, name: "Look", key: "look", kind: "gate" } as const;

    expect(stageChanges([LOOK], [reordered])).toEqual([]);
  });
});

describe("stageFieldChanges", () => {
  const roles = [
    { key: "developer", card: { name: "Jim" } },
    { key: "reviewer", card: { name: "Dwight" } },
  ] as Role[];
  const implement: Stage = {
    kind: "agent",
    key: "implement",
    name: "Implement",
    role: "developer",
    brief: "Implement the Plan.",
    session: "fresh",
    budget: 100_000,
    optional: false,
  };

  it("names each field the change rewrites, in the editor's words and order", () => {
    const proposed: Stage = {
      ...implement,
      role: "reviewer",
      budget: 150_000,
      effort: "high",
      permissions: { web: false, run: "read-only-git" },
    };

    expect(stageFieldChanges(implement, proposed, roles)).toEqual([
      { label: "Who works it", from: "Jim", to: "Dwight" },
      { label: "Budget", from: "100k tokens", to: "150k tokens" },
      { label: "Effort", from: "Role default", to: "High" },
      { label: "Permissions", from: "The Role card's", to: "Runs read-only git only; No web" },
    ]);
  });

  it("names each MCP tool with its setting, so a change of one tool alone shows", () => {
    const titled = [{ key: "devops", card: { name: "Nina", title: "Devops" } }] as Role[];
    const allowed: Stage = {
      ...implement,
      permissions: { mcpTools: { "github/create_issue": { kind: "allowed" } } },
    };
    const consulting: Stage = {
      ...implement,
      permissions: { mcpTools: { "github/create_issue": { kind: "consult", role: "devops" } } },
    };

    expect(stageFieldChanges(allowed, consulting, titled)).toEqual([
      {
        label: "Permissions",
        from: "github/create_issue: Allowed",
        to: "github/create_issue: Consult Devops",
      },
    ]);
  });

  it("reads a field the Stage's kind lacks as None", () => {
    expect(stageFieldChanges(PUBLISH, { ...PUBLISH, publishTarget: "branch-only" }, [])).toEqual([
      {
        label: "Publishes",
        from: "By the Project's publishing mode",
        to: "Push the branch only (proof of concept)",
      },
    ]);
    expect(stageFieldChanges(LOOK, { ...implement, name: "Look" }, roles)).toContainEqual({
      label: "Brief",
      from: "None",
      to: "Implement the Plan.",
    });
  });

  it("finds nothing changed in a Stage alike", () => {
    expect(stageFieldChanges(implement, { ...implement }, roles)).toEqual([]);
  });
});
