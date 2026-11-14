import { describe, expect, it } from "vitest";
import { byTheUser, type Author } from "./author.js";
import { initiativePlanningBrief } from "./initiative-planning.js";
import { planningBrief } from "./planning.js";
import { shapingBrief } from "./shaping.js";
import type { StateChange } from "./state-change.js";
import { taskWhoAskedSection } from "./who-asked.js";
import { ANN_LEE, anInitiative, aTask, BEN_ITO } from "./work.fixtures.js";

const A_PLANNER: Author = { kind: "person", roleKey: "lead" };
const at = new Date("2026-11-12T10:00:00.000Z");
const NO_LINKS = { waitsFor: [], waitingForIt: [], idea: undefined, initiative: undefined };
const PROJECT = {
  name: "Admin panel",
  baseBranch: "main",
  defaultPipeline: "full",
  installCommand: "npm ci",
  commands: [],
};

/** Created by Ann Lee; Ben Ito moved it to Planning. */
const CREATED_THEN_PLANNED: readonly StateChange[] = [
  { from: undefined, to: "backlog", at, by: ANN_LEE },
  { from: "backlog", to: "planning", at, by: BEN_ITO },
];

function aPlanningBrief(stateChanges: readonly StateChange[]): string {
  return planningBrief({
    task: aTask({ state: "planning" }),
    stateChanges,
    project: PROJECT,
    worktree: { path: "/worktrees/task-1", branch: "office/task-1" },
    links: NO_LINKS,
    attachments: [],
    pipelines: [],
  });
}

function anInitiativePlanningBrief(initiative = anInitiative()): string {
  return initiativePlanningBrief({
    initiative,
    waiting: [],
    record: "Initiative: Usage exports",
    tasks: [],
    projects: [],
    pipelines: [],
  });
}

describe("Briefs say which user asked", () => {
  it("the Planner's Brief names who created the Task and who moved it to Planning", () => {
    const brief = aPlanningBrief(CREATED_THEN_PLANNED);

    expect(brief).toContain(
      "## Who asked\n\nThe Task was created by the user Ann Lee and moved to Planning by the user Ben Ito.",
    );
    expect(brief.indexOf("## Who asked")).toBeLessThan(brief.indexOf("## What the user wants"));
  });

  it("names whoever planned it when they moved it, and only the creator when no move was kept", () => {
    expect(
      aPlanningBrief([
        ...CREATED_THEN_PLANNED,
        { from: "ready", to: "planning", at, by: A_PLANNER },
      ]),
    ).toContain("moved to Planning by the person in the Role lead.");
    expect(aPlanningBrief([])).toContain(
      "## Who asked\n\nThe Task was created by the user Ann Lee.",
    );
  });

  it("reads 'the user' for a record kept before users existed", () => {
    expect(
      taskWhoAskedSection(
        aTask({ createdBy: { kind: "user", user: null } }),
        [{ from: "ready", to: "in-progress", at, by: { kind: "user", user: null } }],
        "start",
      ),
    ).toBe("## Who asked\n\nThe Task was created by the user and started by the user.");
  });

  it("an Agent Stage's section names who started the Task, or who queued it", () => {
    const task = aTask({ createdBy: ANN_LEE });
    const startedBy = (by: StateChange["by"]) =>
      taskWhoAskedSection(
        task,
        [
          { from: "planning", to: "ready", at, by: ANN_LEE },
          { from: "ready", to: "in-progress", at, by },
          { from: "in-progress", to: "paused", at, by: ANN_LEE },
          { from: "paused", to: "in-progress", at, by: ANN_LEE },
        ],
        "start",
      );

    expect(startedBy(BEN_ITO)).toBe(
      "## Who asked\n\nThe Task was created by the user Ann Lee and started by the user Ben Ito.",
    );
    expect(startedBy({ kind: "queue", queuedBy: BEN_ITO })).toBe(
      "## Who asked\n\nThe Task was created by the user Ann Lee and started by the queue, as its turn came (queued by the user Ben Ito).",
    );
  });

  it("the Initiative planning Brief names who opened its planning Thread", () => {
    expect(
      anInitiativePlanningBrief(
        anInitiative({ state: "active", createdBy: ANN_LEE, planningStartedBy: BEN_ITO }),
      ),
    ).toContain(
      "Initiative: Usage exports\n\n## Who asked\n\nThis planning Thread was opened by the user Ben Ito, with Plan the Initiative.",
    );
    expect(anInitiativePlanningBrief()).not.toContain("## Who asked");
  });

  it("the shaping Brief names who shaped the Initiative from its Idea, or created it", () => {
    const shaped = anInitiative({ createdBy: BEN_ITO });
    const created = anInitiative({
      originIdeaId: undefined,
      createdBy: byTheUser({ userId: "u-3", name: "Cy Moe" }),
    });

    expect(shapingBrief(shaped, undefined, "The record.", [], [])).toContain(
      "The record.\n\n## Who asked\n\nThe Initiative was shaped from its Idea by the user Ben Ito.",
    );
    expect(shapingBrief(created, undefined, "The record.", [], [])).toContain(
      "## Who asked\n\nThe Initiative was created by the user Cy Moe.",
    );
  });
});
