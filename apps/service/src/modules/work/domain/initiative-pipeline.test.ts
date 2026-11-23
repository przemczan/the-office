import { describe, expect, it } from "vitest";
import {
  addBranch,
  chooseInitiativePipeline,
  confirmInitiative,
  dropInitiative,
  setInitiativePipelines,
  writeShortName,
} from "./initiative-changes.js";
import { initiativeEditProblems } from "./initiative-edit.js";
import {
  InitiativeBranchMade,
  InitiativePipelineChosen,
  InitiativePipelinesSet,
  InitiativeShortNameWritten,
} from "./initiative-events.js";
import { InitiativeNotShaping } from "./initiative-not-shaping.js";
import { initiativePipelineChangeProblems } from "./initiative-pipeline.js";
import { InitiativeRefused } from "./initiative-refused.js";
import type { PipelineCommands, TaskPipelineChoice } from "./pipeline-commands.js";
import { initiativePipelineLines } from "./record-words.js";
import { shapingBrief, shapingOpeningOf } from "./shaping.js";
import { ANN_LEE, anInitiative, aTask } from "./work.fixtures.js";
import { defaultWorkPrompts } from "./work-prompt-templates.fixtures.js";

const prompts = defaultWorkPrompts();

const at = new Date("2026-11-12T10:00:00.000Z");
const NONE_TAKEN = new Set<string>();

/** A Project named by its id, as the words below name it. */
function named(id: string): { id: string; name: string } {
  return { id, name: id };
}
const SYNC = { name: "Sync it", state: "shaping" as const };
/** On Full in app only, None in any other Project. */
const ON_FULL = {
  ...SYNC,
  pipelines: [{ projectId: "app", pipelineId: "full" }],
  shortName: "sync-it",
};
/** On Full in app and Quick in api. */
const ON_TWO = {
  ...SYNC,
  pipelines: [
    { projectId: "app", pipelineId: "full" },
    { projectId: "api", pipelineId: "quick" },
  ],
  shortName: "sync-it",
};

function refusalOf(change: () => unknown): readonly string[] {
  try {
    change();
  } catch (error) {
    if (error instanceof InitiativeRefused) return error.reasons;
    throw error;
  }
  throw new Error("It wasn't refused.");
}

describe("chooseInitiativePipeline", () => {
  it("chooses straight in one Project while shaping, deriving the Short name from the title", () => {
    const change = chooseInitiativePipeline(
      anInitiative(SYNC),
      named("app"),
      "full",
      "straight",
      NONE_TAKEN,
    );

    expect(change?.initiative).toMatchObject({
      pipelines: [{ projectId: "app", pipelineId: "full" }],
      shortName: "sync-it",
    });
    expect(change?.event).toBeInstanceOf(InitiativePipelineChosen);
    expect(change?.event).toMatchObject({
      projectId: "app",
      pipelineId: "full",
      shortName: "sync-it",
    });
  });

  it("derives past the Short names other Initiatives hold", () => {
    const change = chooseInitiativePipeline(
      anInitiative(SYNC),
      named("app"),
      "full",
      "straight",
      new Set(["sync-it"]),
    );

    expect(change?.initiative.shortName).toBe("sync-it-2");
  });

  it("gives two Projects different Pipelines under one Short name", () => {
    const change = chooseInitiativePipeline(
      anInitiative(ON_FULL),
      named("api"),
      "quick",
      "straight",
      new Set(["sync-it"]),
    );

    expect(change?.initiative).toMatchObject({
      pipelines: [
        { projectId: "app", pipelineId: "full" },
        { projectId: "api", pipelineId: "quick" },
      ],
      shortName: "sync-it",
    });
  });

  it("keeps the Short name it has when another Pipeline is chosen", () => {
    const initiative = anInitiative({ ...ON_FULL, shortName: "mine" });

    const change = chooseInitiativePipeline(
      initiative,
      named("app"),
      "quick",
      "straight",
      NONE_TAKEN,
    );

    expect(change?.initiative).toMatchObject({
      pipelines: [{ projectId: "app", pipelineId: "quick" }],
      shortName: "mine",
    });
  });

  it("goes back to None in one Project while shaping, keeping the Short name while another has one", () => {
    const change = chooseInitiativePipeline(
      anInitiative(ON_TWO),
      named("app"),
      undefined,
      "straight",
      NONE_TAKEN,
    );

    expect(change?.initiative).toMatchObject({
      pipelines: [{ projectId: "api", pipelineId: "quick" }],
      shortName: "sync-it",
    });
  });

  it("goes back to None everywhere while shaping, keeping no entry and no Short name", () => {
    const change = chooseInitiativePipeline(
      anInitiative(ON_FULL),
      named("app"),
      undefined,
      "straight",
      NONE_TAKEN,
    );

    expect(change?.initiative.pipelines).toEqual([]);
    expect(change?.initiative.shortName).toBeUndefined();
    expect(change?.event).toMatchObject({ projectId: "app", pipelineId: undefined });
  });

  it("changes nothing when the Project follows that Pipeline already", () => {
    expect(
      chooseInitiativePipeline(anInitiative(ON_FULL), named("app"), "full", "straight", NONE_TAKEN),
    ).toBeUndefined();
    expect(
      chooseInitiativePipeline(
        anInitiative(ON_FULL),
        named("api"),
        undefined,
        "straight",
        NONE_TAKEN,
      ),
    ).toBeUndefined();
  });

  it("isn't straight once active, so the CTO's change becomes a Proposal", () => {
    const active = anInitiative({ ...ON_FULL, state: "active" });

    expect(() =>
      chooseInitiativePipeline(active, named("app"), "quick", "straight", NONE_TAKEN),
    ).toThrow(InitiativeNotShaping);
    expect(
      chooseInitiativePipeline(active, named("app"), "quick", "by-proposal", NONE_TAKEN)
        ?.initiative,
    ).toMatchObject({
      pipelines: [{ projectId: "app", pipelineId: "quick" }],
      shortName: "sync-it",
    });
  });

  it("refuses None once active in a Project with a Pipeline, and any in a Project Confirm fixed on None", () => {
    const active = anInitiative({
      ...ON_FULL,
      state: "active",
      pipelines: [
        { projectId: "app", pipelineId: "full" },
        { projectId: "api", pipelineId: undefined },
      ],
    });

    expect(
      refusalOf(() =>
        chooseInitiativePipeline(active, named("app"), undefined, "by-proposal", NONE_TAKEN),
      ),
    ).toEqual(["Whether the Initiative has a Pipeline in app was fixed at Confirm."]);
    expect(
      refusalOf(() =>
        chooseInitiativePipeline(active, named("api"), "full", "by-proposal", NONE_TAKEN),
      ),
    ).toEqual(["Whether the Initiative has a Pipeline in api was fixed at Confirm."]);
  });

  it("gives a Project spanned since Confirm, which has None, a first Pipeline by Proposal", () => {
    const active = anInitiative({
      ...SYNC,
      state: "active",
      pipelines: [{ projectId: "app", pipelineId: undefined }],
    });

    const change = chooseInitiativePipeline(
      active,
      named("web"),
      "full",
      "by-proposal",
      NONE_TAKEN,
    );

    expect(change?.initiative).toMatchObject({
      pipelines: [
        { projectId: "app", pipelineId: undefined },
        { projectId: "web", pipelineId: "full" },
      ],
      shortName: "sync-it",
    });
    expect(
      refusalOf(() =>
        chooseInitiativePipeline(active, named("web"), undefined, "by-proposal", NONE_TAKEN),
      ),
    ).toEqual(["Whether the Initiative has a Pipeline in web was fixed at Confirm."]);
  });
});

describe("writeShortName", () => {
  it("writes the user's own Short name while shaping", () => {
    const change = writeShortName(anInitiative(ON_FULL), " sync-2026 ", NONE_TAKEN);

    expect(change?.initiative.shortName).toBe("sync-2026");
    expect(change?.event).toBeInstanceOf(InitiativeShortNameWritten);
  });

  it("refuses a name that is taken or not of the form", () => {
    expect(
      refusalOf(() => writeShortName(anInitiative(ON_FULL), "mine", new Set(["mine"]))),
    ).toEqual(["Another Initiative has the Short name mine; choose another."]);
    expect(
      refusalOf(() => writeShortName(anInitiative(ON_FULL), "Mine!", NONE_TAKEN)),
    ).toHaveLength(1);
  });

  it("refuses on None in every Project, and once the Initiative is confirmed", () => {
    expect(refusalOf(() => writeShortName(anInitiative(SYNC), "mine", NONE_TAKEN))).toEqual([
      "Choose a Pipeline first: an Initiative on None in every Project has no branch to name.",
    ]);
    expect(() =>
      writeShortName(anInitiative({ ...ON_FULL, state: "active" }), "mine", NONE_TAKEN),
    ).toThrow(InitiativeNotShaping);
  });
});

describe("setInitiativePipelines", () => {
  it("sets every Project's Pipeline and the user's Short name at once while shaping", () => {
    const change = setInitiativePipelines(
      anInitiative(ON_FULL),
      [
        { projectId: "app", pipelineId: undefined },
        { projectId: "api", pipelineId: "quick" },
      ],
      " sync-2026 ",
      NONE_TAKEN,
    );

    expect(change?.initiative).toMatchObject({
      pipelines: [{ projectId: "api", pipelineId: "quick" }],
      shortName: "sync-2026",
    });
    expect(change?.event).toBeInstanceOf(InitiativePipelinesSet);
    expect(change?.event).toMatchObject({
      pipelines: [{ projectId: "api", pipelineId: "quick" }],
      shortName: "sync-2026",
    });
  });

  it("keeps the Pipelines of the Projects it doesn't name", () => {
    const change = setInitiativePipelines(
      anInitiative(ON_TWO),
      [{ projectId: "api", pipelineId: "full" }],
      "sync-it",
      NONE_TAKEN,
    );

    expect(change?.initiative.pipelines).toEqual([
      { projectId: "app", pipelineId: "full" },
      { projectId: "api", pipelineId: "full" },
    ]);
  });

  it("without a Short name keeps the one it has, or derives one past those taken", () => {
    const kept = setInitiativePipelines(
      anInitiative(ON_FULL),
      [{ projectId: "app", pipelineId: "quick" }],
      undefined,
      NONE_TAKEN,
    );
    const derived = setInitiativePipelines(
      anInitiative(SYNC),
      [{ projectId: "app", pipelineId: "full" }],
      undefined,
      new Set(["sync-it"]),
    );

    expect(kept?.initiative.shortName).toBe("sync-it");
    expect(derived?.initiative.shortName).toBe("sync-it-2");
  });

  it("with None in every Project leaves no Short name", () => {
    const change = setInitiativePipelines(
      anInitiative(ON_FULL),
      [{ projectId: "app", pipelineId: undefined }],
      "sync-it",
      NONE_TAKEN,
    );

    expect(change?.initiative).toMatchObject({ pipelines: [], shortName: undefined });
    expect(change?.event).toMatchObject({ pipelines: [], shortName: undefined });
  });

  it("changes nothing when the block says so already", () => {
    expect(
      setInitiativePipelines(
        anInitiative(ON_FULL),
        [{ projectId: "app", pipelineId: "full" }],
        "sync-it",
        NONE_TAKEN,
      ),
    ).toBeUndefined();
  });

  it("refuses a Short name that is taken or not of the form, with nothing set", () => {
    expect(
      refusalOf(() =>
        setInitiativePipelines(
          anInitiative(ON_FULL),
          [{ projectId: "api", pipelineId: "quick" }],
          "mine",
          new Set(["mine"]),
        ),
      ),
    ).toEqual(["Another Initiative has the Short name mine; choose another."]);
    expect(
      refusalOf(() =>
        setInitiativePipelines(
          anInitiative(ON_FULL),
          [{ projectId: "app", pipelineId: "full" }],
          "Mine!",
          NONE_TAKEN,
        ),
      ),
    ).toHaveLength(1);
  });

  it("refuses once the Initiative is confirmed", () => {
    expect(() =>
      setInitiativePipelines(
        anInitiative({ ...ON_FULL, state: "active" }),
        [{ projectId: "app", pipelineId: "quick" }],
        "sync-it",
        NONE_TAKEN,
      ),
    ).toThrow(InitiativeNotShaping);
  });
});

describe("confirmInitiative with the Initiative's Pipelines", () => {
  const tasks = [
    aTask({ id: "a", projectId: "app", state: "shaping", initiativeId: "initiative-1" }),
    aTask({ id: "b", projectId: "api", state: "backlog", initiativeId: "initiative-1" }),
  ];

  it("keeps the branch made in each Project with a Pipeline, two on different Pipelines", () => {
    const branched = { shortName: "sync-it", projectIds: ["app", "api"], madeAt: at };

    const { initiative } = confirmInitiative(anInitiative(ON_TWO), tasks, branched, ANN_LEE);

    expect(initiative).toMatchObject({
      state: "active",
      pipelines: [
        { projectId: "app", pipelineId: "full" },
        { projectId: "api", pipelineId: "quick" },
      ],
      shortName: "sync-it",
      branches: [
        { projectId: "app", madeAt: at },
        { projectId: "api", madeAt: at },
      ],
    });
  });

  it("fixes None for a Project with no Pipeline beside one with a Pipeline, branched only there", () => {
    const branched = { shortName: "sync-it", projectIds: ["app"], madeAt: at };

    const { initiative } = confirmInitiative(anInitiative(ON_FULL), tasks, branched, ANN_LEE);

    expect(initiative.pipelines).toEqual([
      { projectId: "app", pipelineId: "full" },
      { projectId: "api", pipelineId: undefined },
    ]);
    expect(initiative.branches).toEqual([{ projectId: "app", madeAt: at }]);
  });

  it("is refused when a Project with a Pipeline, one in Shaping too, has no branch made", () => {
    const branched = { shortName: "sync-it", projectIds: ["api"], madeAt: at };

    expect(
      refusalOf(() => confirmInitiative(anInitiative(ON_TWO), tasks, branched, ANN_LEE)),
    ).toEqual(["The Initiative changed while it was being confirmed; confirm it again."]);
  });

  it("is refused when a branch was made in a Project on None", () => {
    const branched = { shortName: "sync-it", projectIds: ["app", "api"], madeAt: at };

    expect(
      refusalOf(() => confirmInitiative(anInitiative(ON_FULL), tasks, branched, ANN_LEE)),
    ).toEqual(["The Initiative changed while it was being confirmed; confirm it again."]);
  });

  it("is refused when its Short name changed after the branches were made", () => {
    const branched = { shortName: "old", projectIds: ["app", "api"], madeAt: at };

    expect(() => confirmInitiative(anInitiative(ON_TWO), tasks, branched, ANN_LEE)).toThrow(
      InitiativeRefused,
    );
  });

  it("fixes None in every Project, keeping no Short name and making no branch", () => {
    const { initiative } = confirmInitiative(
      anInitiative({ ...SYNC, shortName: "left-over" }),
      tasks,
      undefined,
      ANN_LEE,
    );

    expect(initiative.pipelines).toEqual([
      { projectId: "app", pipelineId: undefined },
      { projectId: "api", pipelineId: undefined },
    ]);
    expect(initiative.shortName).toBeUndefined();
    expect(initiative.branches).toEqual([]);
  });
});

describe("dropInitiative", () => {
  it("keeps the Initiative's branches", () => {
    const branches = [{ projectId: "app", madeAt: at }];
    const active = anInitiative({ ...ON_FULL, state: "active", branches });

    expect(dropInitiative(active, [], at, ANN_LEE)?.initiative.branches).toEqual(branches);
  });
});

describe("addBranch", () => {
  const active = anInitiative({
    ...ON_TWO,
    state: "active",
    pipelines: [...ON_TWO.pipelines, { projectId: "web", pipelineId: undefined }],
    branches: [{ projectId: "app", madeAt: at }],
  });

  it("keeps the branch made in a Project with a Pipeline it comes to span", () => {
    const change = addBranch(active, "api", at);

    expect(change?.initiative.branches).toEqual([
      { projectId: "app", madeAt: at },
      { projectId: "api", madeAt: at },
    ]);
    expect(change?.event).toBeInstanceOf(InitiativeBranchMade);
    expect(change?.event).toMatchObject({ projectId: "api", branch: "initiative/sync-it" });
  });

  it("changes nothing for a Project whose branch it has", () => {
    expect(addBranch(active, "app", at)).toBeUndefined();
  });

  it("is refused in a Project on None", () => {
    expect(refusalOf(() => addBranch(active, "web", at))).toEqual([
      "The Initiative has None in web, so no branch to make.",
    ]);
  });
});

describe("the pipeline edit", () => {
  const active = anInitiative({ ...ON_FULL, state: "active" });

  it("has no problem for another Pipeline", () => {
    expect(
      initiativeEditProblems(
        active,
        { kind: "pipeline", projectId: "app", pipelineId: "quick" },
        [],
      ),
    ).toEqual([]);
  });

  it("names the Pipeline the Project follows already", () => {
    expect(
      initiativeEditProblems(
        active,
        { kind: "pipeline", projectId: "app", pipelineId: "full" },
        [],
        { pipeline: "Full" },
      ),
    ).toEqual(["The Initiative follows Full in app already."]);
  });

  it("is refused for None", () => {
    expect(
      initiativeEditProblems(active, { kind: "pipeline", projectId: "app", pipelineId: null }, []),
    ).toEqual(["Whether the Initiative has a Pipeline in app was fixed at Confirm."]);
  });
});

describe("initiativePipelineChangeProblems", () => {
  const full = { name: "Full", keys: ["test", "lint"], hasGate: true, broken: [] };
  const app = { id: "app", name: "App", commands: [{ key: "test" }, { key: "lint" }] };
  const api = { id: "api", name: "Api", commands: [{ key: "test" }, { key: "lint" }] };
  const active = anInitiative({
    ...ON_TWO,
    state: "active",
    pipelines: [
      { projectId: "app", pipelineId: "quick" },
      { projectId: "api", pipelineId: "quick" },
    ],
  });
  const choice = (
    pipelineId: string,
    pipeline: PipelineCommands = full,
    ownerName?: string,
  ): TaskPipelineChoice => ({
    pipelineId,
    pipeline,
    ownerName,
    choices: [],
  });
  const publishingIn = (projectId: string, state: "ready" | "in-progress") =>
    aTask({
      id: `publish-${projectId}`,
      title: `Publish Sync it in ${projectId}`,
      projectId,
      state,
      madeFor: "publishing",
      initiativeId: active.id,
    });

  it("refuses the CTO's Proposal when that Project lacks a command", () => {
    expect(
      initiativePipelineChangeProblems(active, { ...api, commands: [] }, choice("full"), []),
    ).toEqual([
      "The Pipeline Full runs test and lint, which Api has no commands for. Add them on the Project page, or choose another Pipeline.",
    ]);
  });

  it("refuses it once that Project's Publishing Task started, not for another Project's", () => {
    const tasks = [publishingIn("app", "in-progress"), publishingIn("api", "ready")];

    expect(initiativePipelineChangeProblems(active, app, choice("full"), tasks)).toEqual([
      "The Initiative's Pipeline in App started in Publish Sync it in app, so it can't change.",
    ]);
    expect(initiativePipelineChangeProblems(active, api, choice("full"), tasks)).toEqual([]);
  });

  it("accepts the Project's own Project Pipeline and refuses another Project's", () => {
    const appsOwn = { ...full, name: "App's checks", projectId: "app" };

    expect(initiativePipelineChangeProblems(active, app, choice("apps-own", appsOwn), [])).toEqual(
      [],
    );
    expect(
      initiativePipelineChangeProblems(active, api, choice("apps-own", appsOwn, "App"), []),
    ).toEqual(["App's checks is a Project Pipeline of App: only App's Tasks can follow it."]);
  });

  it("refuses a Project Pipeline Broken before The Office updated", () => {
    const broken = { ...full, name: "App's checks", projectId: "app", broken: ["Gone."] };

    expect(initiativePipelineChangeProblems(active, app, choice("apps-own", broken), [])).toEqual([
      "App's checks was Broken before The Office updated: Gone. Save it once in App's Pipelines, or choose another Pipeline.",
    ]);
  });

  it("refuses None once active", () => {
    expect(initiativePipelineChangeProblems(active, app, undefined, [])).toEqual([
      "Whether the Initiative has a Pipeline in App was fixed at Confirm.",
    ]);
  });
});

describe("what the CTO and read_initiative read of the Initiative's Pipelines", () => {
  const pipelines = [
    { id: "full", name: "Full", description: "For most work.", stages: [{ name: "Implement" }] },
  ];
  const appsOwn = {
    id: "apps-checks",
    name: "App's checks",
    description: "",
    stages: [{ name: "Implement" }],
  };
  const projects = [
    { id: "app", name: "App", ownPipelines: [appsOwn] },
    { id: "api", name: "Api", ownPipelines: [] },
  ];

  it("names each Project's Pipeline or None, the Short name and the branch in each Project", () => {
    const active = anInitiative({
      ...ON_FULL,
      state: "active",
      pipelines: [
        { projectId: "app", pipelineId: "full" },
        { projectId: "api", pipelineId: undefined },
      ],
      branches: [{ projectId: "app", madeAt: at }],
    });

    expect(initiativePipelineLines(active, ["app", "api"], new Map([["full", "Full"]]))).toEqual([
      "- Initiative's Pipeline in the Project app: Full (full)",
      "- Initiative's Pipeline in the Project api: None, so each of its Tasks publishes on its own",
      "- Short name: sync-it",
      `- Initiative's branch initiative/sync-it in the Project app, made on ${at.toISOString()}`,
    ]);
    expect(initiativePipelineLines(anInitiative(SYNC), ["app"], new Map())).toEqual([
      "- Initiative's Pipeline in the Project app: None, so each of its Tasks publishes on its own",
    ]);
  });

  it("names a Pipeline the library lost by its id", () => {
    expect(initiativePipelineLines(anInitiative(ON_FULL), ["app"], new Map())).toEqual([
      "- Initiative's Pipeline in the Project app: full",
      "- Short name: sync-it",
    ]);
  });

  it("lists each Project's Pipeline in the shaping Brief, None until one is chosen", () => {
    const brief = shapingBrief(
      prompts,
      anInitiative(SYNC),
      undefined,
      "The record.",
      projects,
      pipelines,
    );

    expect(brief).toContain("The record.");
    expect(brief).toContain("- App (app): None, so each of its Tasks publishes on its own.");
    expect(brief).toContain("- Api (api): None, so each of its Tasks publishes on its own.");
    expect(brief).toContain("whether each Project has one is fixed at Confirm");
    expect(brief).toContain("- full: Full (Implement). For most work.");
  });

  it("lists a Project's own Pipelines apart in the shaping Brief, and the one it follows", () => {
    const initiative = anInitiative({
      ...SYNC,
      pipelines: [
        { projectId: "app", pipelineId: "apps-checks" },
        { projectId: "api", pipelineId: "full" },
      ],
      shortName: "sync-it",
    });

    const brief = shapingBrief(prompts, initiative, undefined, "The record.", projects, pipelines);

    expect(brief).toContain("- App (app): App's checks.");
    expect(brief).toContain("- Api (api): Full.");
    expect(brief).toContain(
      "App's own Pipelines, which only its Tasks can follow:\n- apps-checks: App's checks (Implement).",
    );
    expect(brief).toContain("Office-wide Pipelines:\n- full: Full (Implement). For most work.");
  });

  it("tells the CTO the Initiative's Tasks are in the Project its Idea was captured in", () => {
    const brief = shapingBrief(
      prompts,
      anInitiative(SYNC),
      "app",
      "The record.",
      projects,
      pipelines,
    );

    expect(brief).toContain(
      "The Idea was captured in the Project app, so the Initiative's Tasks are in app unless the user names other Projects: don't ask which Project it is for.",
    );
  });

  it("names no Project in the shaping Brief of an Initiative shaped from an Office-wide Idea", () => {
    const brief = shapingBrief(
      prompts,
      anInitiative(SYNC),
      undefined,
      "The record.",
      projects,
      pipelines,
    );

    expect(brief).not.toContain("The Idea was captured in the Project");
    expect(brief).not.toContain("don't ask which Project");
  });

  it("opens shaping asking which Projects it touches only for an Idea captured Office-wide", () => {
    expect(shapingOpeningOf(prompts, anInitiative())).toContain(
      "When the Idea was captured Office-wide, also ask which Projects it touches",
    );
    expect(shapingOpeningOf(prompts, anInitiative())).toContain(
      "when it was captured in a Project, ask only whether it reaches other Projects too",
    );
  });
});
