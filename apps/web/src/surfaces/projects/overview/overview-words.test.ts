import type {
  EnvironmentCheck,
  ProjectSettingChange,
  ProjectTestInstances,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  aCiRun,
  anIdea,
  anInitiative,
  anInstance,
  aSettingChange,
  aTask,
  hoursAgo,
  NOW,
  PROJECT,
} from "./overview.fixtures.ts";
import {
  ACTIVITY_LINES,
  activeTestInstances,
  activityLines,
  type ActivityLine,
  firstFailedStep,
  initiativesOfProject,
  newestCiRuns,
  newIdeasOfProject,
  remoteSignIn,
  settingChangeWords,
} from "./overview-words.ts";

const DAY_HOURS = 24;

describe("initiativesOfProject", () => {
  it("keeps the Project's Shaping and Active Initiatives, the Active first, with their progress", () => {
    const shaping = anInitiative("shaping", { state: "shaping" });
    const active = anInitiative("active");
    const initiatives = [
      shaping,
      anInitiative("done", { state: "done" }),
      anInitiative("dropped", { state: "dropped" }),
      anInitiative("archived", { archivedAt: hoursAgo(1) }),
      anInitiative("elsewhere", { projectIds: ["blog"] }),
      active,
    ];
    const tasks = [
      aTask("a", { initiativeId: "active", state: "done" }),
      aTask("b", { initiativeId: "active" }),
      aTask("c", { initiativeId: "active", state: "dropped" }),
      aTask("d"),
    ];

    const going = initiativesOfProject(initiatives, tasks, PROJECT.id);

    expect(going.map(({ initiative }) => initiative.id)).toEqual(["active", "shaping"]);
    expect(going[0]?.progress).toEqual({ done: 1, counted: 2, readyToStart: 0 });
    expect(going[1]?.progress).toEqual({ done: 0, counted: 0, readyToStart: 0 });
  });
});

describe("newIdeasOfProject", () => {
  it("keeps the Project's New Ideas, the newest captured first", () => {
    const ideas = [
      anIdea("older", { capturedAt: hoursAgo(5) }),
      anIdea("shaped", { state: "shaped" }),
      anIdea("elsewhere", { projectId: "blog" }),
      anIdea("newer", { capturedAt: hoursAgo(1) }),
    ];

    expect(newIdeasOfProject(ideas, PROJECT.id).map(({ id }) => id)).toEqual(["newer", "older"]);
  });
});

describe("activeTestInstances", () => {
  it("keeps the Building and Running instances on every branch, the newest launched first", () => {
    const testInstances: ProjectTestInstances = {
      runEnvironmentOn: true,
      targets: [],
      initiatives: [],
      branches: [
        {
          name: "main",
          branchCommit: null,
          instances: [
            anInstance("old", { launchedAt: hoursAgo(4) }),
            anInstance("stopped", { state: "stopped" }),
          ],
        },
        {
          name: "initiative/shop",
          branchCommit: null,
          instances: [
            anInstance("building", { state: "building", launchedAt: hoursAgo(1) }),
            anInstance("built", { state: "built", kind: "build-to-install" }),
          ],
        },
      ],
    };

    expect(activeTestInstances(testInstances).map(({ id }) => id)).toEqual(["building", "old"]);
  });
});

describe("newestCiRuns", () => {
  it("is the newest run on the base branch, and a newer one on another branch", () => {
    const runs = [
      aCiRun(3, { branch: "office/abc" }),
      aCiRun(2),
      aCiRun(1),
      aCiRun(9, { projectId: "blog" }),
    ];

    const newest = newestCiRuns(runs, PROJECT.id, PROJECT.baseBranch);

    expect(newest.onBaseBranch?.id).toBe(2);
    expect(newest.newer?.id).toBe(3);
  });

  it("leaves out a newer run when the newest is the base branch's", () => {
    const newest = newestCiRuns(
      [aCiRun(2), aCiRun(1, { branch: "office/abc" })],
      PROJECT.id,
      PROJECT.baseBranch,
    );

    expect(newest.onBaseBranch?.id).toBe(2);
    expect(newest.newer).toBeUndefined();
  });

  it("has nothing on the base branch when no run ran there", () => {
    const newest = newestCiRuns(
      [aCiRun(1, { branch: "office/abc" })],
      PROJECT.id,
      PROJECT.baseBranch,
    );

    expect(newest.onBaseBranch).toBeUndefined();
    expect(newest.newer?.id).toBe(1);
  });
});

describe("activityLines", () => {
  it("lists Tasks done or published, Ideas captured and setting changes in the last 7 days, newest first", () => {
    const tasks = [
      aTask("done", { state: "done", endedAt: hoursAgo(1) }),
      aTask("done-and-published", {
        state: "done",
        endedAt: hoursAgo(3),
        commitMessagePublishedAt: hoursAgo(4),
      }),
      aTask("published", { state: "in-progress", commitMessagePublishedAt: hoursAgo(5) }),
      aTask("too-old", { state: "done", endedAt: hoursAgo(8 * DAY_HOURS) }),
      aTask("dropped", { state: "dropped", endedAt: hoursAgo(1) }),
      aTask("elsewhere", { projectId: "blog", state: "done", endedAt: hoursAgo(1) }),
    ];
    const ideas = [
      anIdea("captured", { capturedAt: hoursAgo(2) }),
      anIdea("idea-too-old", { capturedAt: hoursAgo(7 * DAY_HOURS + 1) }),
      anIdea("idea-elsewhere", { projectId: null }),
    ];

    const settingChanges = [
      aSettingChange("commands", { at: hoursAgo(2.5) }),
      aSettingChange("setting-too-old", { at: hoursAgo(8 * DAY_HOURS) }),
    ];

    const lines = activityLines(tasks, ideas, settingChanges, PROJECT.id, NOW);

    expect(lines.map((line) => [line.kind, recordIdOf(line)])).toEqual([
      ["done", "done"],
      ["idea-captured", "captured"],
      ["setting-changed", "commands"],
      ["done", "done-and-published"],
      ["published", "published"],
    ]);
    expect(lines.map((line) => line.kind === "done" && line.published)).toEqual([
      false,
      false,
      false,
      true,
      false,
    ]);
  });

  it("shows 10 lines at most", () => {
    const ideas = Array.from({ length: 12 }, (_, index) =>
      anIdea(`idea-${index}`, { capturedAt: hoursAgo(index + 1) }),
    );

    const lines = activityLines([], ideas, [], PROJECT.id, NOW);

    expect(lines).toHaveLength(ACTIVITY_LINES);
    expect(lines[0]?.at).toBe(hoursAgo(1));
  });
});

describe("settingChangeWords", () => {
  it("names who made the change: a user, a user by Proposal, a Proposal alone, or a person by title", () => {
    const ann = { userId: "user-ann", name: "Ann Lee" };

    expect(sentence({ kind: "user", user: ann })).toBe("Ann Lee changed Commands");
    expect(sentence({ kind: "proposal", proposalId: "p-1", user: ann })).toBe(
      "Ann Lee changed Commands by Proposal",
    );
    expect(sentence({ kind: "proposal", proposalId: "p-1", user: null })).toBe(
      "A Proposal changed Commands",
    );
    expect(
      sentence({ kind: "person", roleKey: "devops", name: "Nina", title: "Devops", taskId: "t-1" }),
    ).toBe("Nina (Devops) changed Commands");
  });
});

/** A setting change's line read as one sentence, made `by`. */
function sentence(by: ProjectSettingChange["by"]): string {
  const { who, what } = settingChangeWords(aSettingChange("change", { by }));
  return `${who} ${what}`;
}

function recordIdOf(line: ActivityLine): string {
  switch (line.kind) {
    case "idea-captured":
      return line.idea.id;
    case "setting-changed":
      return line.change.id;
    default:
      return line.task.id;
  }
}

describe("firstFailedStep", () => {
  const failed: EnvironmentCheck = {
    projectId: PROJECT.id,
    environment: PROJECT.environment,
    state: "failed",
    checks: [
      { step: "worktree", state: "passed" },
      { step: "install", state: "passed", commandLine: "npm ci" },
      {
        step: "command",
        state: "failed",
        key: "test",
        name: "Test",
        kind: "test",
        commandLine: "npm test",
      },
    ],
    startedAt: hoursAgo(1),
    finishedAt: hoursAgo(1),
  };

  it("names a failed check's first failed step", () => {
    expect(firstFailedStep(failed, PROJECT)).toBe("Test");
  });

  it("names nothing when the check didn't fail", () => {
    expect(firstFailedStep({ ...failed, state: "passed" }, PROJECT)).toBeUndefined();
  });
});

describe("remoteSignIn", () => {
  it("is healthy when the remote needs nothing missing", () => {
    expect(remoteSignIn({ kind: "github-https", missing: [] }, null, [])).toEqual({
      tone: "success",
      needs: "Its remote is GitHub over https, reached with Sign in with GitHub.",
      problems: [],
    });
  });

  it("warns of what is missing and of the code host refusing reads, each once", () => {
    const signIn = remoteSignIn(
      { kind: "github-https", missing: ["sign-in-with-github"] },
      { kind: "cannot-read", text: "GitHub refused to be read." },
      [
        { kind: "cannot-read", projectId: PROJECT.id, text: "GitHub refused to be read." },
        {
          kind: "unreachable",
          projectId: PROJECT.id,
          codeHost: "GitHub",
          failedAt: hoursAgo(1),
          lastReadAt: null,
        },
      ],
    );

    expect(signIn.tone).toBe("warning");
    expect(signIn.problems).toEqual(["Not signed in with GitHub.", "GitHub refused to be read."]);
  });

  it("is neutral for a remote that needs nothing of the Office identity", () => {
    expect(remoteSignIn({ kind: "local" }, undefined, []).tone).toBe("neutral");
  });
});
