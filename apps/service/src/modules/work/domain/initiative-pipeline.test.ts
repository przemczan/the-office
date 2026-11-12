import { describe, expect, it } from "vitest";
import {
  addBranch,
  chooseInitiativePipeline,
  confirmInitiative,
  dropInitiative,
  writeShortName,
} from "./initiative-changes.js";
import { initiativeEditProblems } from "./initiative-edit.js";
import {
  InitiativeBranchMade,
  InitiativePipelineChosen,
  InitiativeShortNameWritten,
} from "./initiative-events.js";
import { InitiativeNotShaping } from "./initiative-not-shaping.js";
import {
  initiativePipelineChangeProblems,
  initiativePipelineProblems,
} from "./initiative-pipeline.js";
import { InitiativeRefused } from "./initiative-refused.js";
import { initiativePipelineLines } from "./record-words.js";
import { shapingBrief } from "./shaping.js";
import { anInitiative, aTask } from "./work.fixtures.js";

const at = new Date("2026-11-12T10:00:00.000Z");
const NONE_TAKEN = new Set<string>();
const SYNC = { name: "Sync it", state: "shaping" as const };
const ON_FULL = { ...SYNC, pipelineId: "full", shortName: "sync-it" };

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
  it("chooses straight while shaping, deriving the Short name from the title", () => {
    const change = chooseInitiativePipeline(anInitiative(SYNC), "full", "straight", NONE_TAKEN);

    expect(change?.initiative).toMatchObject({ pipelineId: "full", shortName: "sync-it" });
    expect(change?.event).toBeInstanceOf(InitiativePipelineChosen);
    expect(change?.event).toMatchObject({ pipelineId: "full", shortName: "sync-it" });
  });

  it("derives past the Short names other Initiatives hold", () => {
    const change = chooseInitiativePipeline(
      anInitiative(SYNC),
      "full",
      "straight",
      new Set(["sync-it"]),
    );

    expect(change?.initiative.shortName).toBe("sync-it-2");
  });

  it("keeps the Short name it has when another Pipeline is chosen", () => {
    const initiative = anInitiative({ ...ON_FULL, shortName: "mine" });

    const change = chooseInitiativePipeline(initiative, "quick", "straight", NONE_TAKEN);

    expect(change?.initiative).toMatchObject({ pipelineId: "quick", shortName: "mine" });
  });

  it("goes back to None while shaping, keeping no Short name", () => {
    const change = chooseInitiativePipeline(
      anInitiative(ON_FULL),
      undefined,
      "straight",
      NONE_TAKEN,
    );

    expect(change?.initiative.pipelineId).toBeUndefined();
    expect(change?.initiative.shortName).toBeUndefined();
  });

  it("changes nothing when it follows that Pipeline already", () => {
    expect(
      chooseInitiativePipeline(anInitiative(ON_FULL), "full", "straight", NONE_TAKEN),
    ).toBeUndefined();
  });

  it("isn't straight once active, so the CTO's change becomes a Proposal", () => {
    const active = anInitiative({ ...ON_FULL, state: "active" });

    expect(() => chooseInitiativePipeline(active, "quick", "straight", NONE_TAKEN)).toThrow(
      InitiativeNotShaping,
    );
    expect(
      chooseInitiativePipeline(active, "quick", "by-proposal", NONE_TAKEN)?.initiative,
    ).toMatchObject({ pipelineId: "quick", shortName: "sync-it" });
  });

  it("refuses None for an active Initiative with a Pipeline, and any for one confirmed on None", () => {
    const withOne = anInitiative({ ...ON_FULL, state: "active" });
    const onNone = anInitiative({ ...SYNC, state: "active" });

    for (const [initiative, pipelineId] of [
      [withOne, undefined],
      [onNone, "full"],
    ] as const) {
      expect(
        refusalOf(() =>
          chooseInitiativePipeline(initiative, pipelineId, "by-proposal", NONE_TAKEN),
        ),
      ).toEqual(["Whether the Initiative has a Pipeline was fixed at Confirm."]);
    }
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

  it("refuses on None, and once the Initiative is confirmed", () => {
    expect(refusalOf(() => writeShortName(anInitiative(SYNC), "mine", NONE_TAKEN))).toEqual([
      "Choose a Pipeline first: an Initiative on None has no branch to name.",
    ]);
    expect(() =>
      writeShortName(anInitiative({ ...ON_FULL, state: "active" }), "mine", NONE_TAKEN),
    ).toThrow(InitiativeNotShaping);
  });
});

describe("confirmInitiative with the Initiative's Pipeline", () => {
  const tasks = [
    aTask({ id: "a", projectId: "app", state: "shaping", initiativeId: "initiative-1" }),
    aTask({ id: "b", projectId: "api", state: "backlog", initiativeId: "initiative-1" }),
  ];

  it("keeps the branch made in each Project its Tasks span", () => {
    const branched = { shortName: "sync-it", projectIds: ["app", "api"], madeAt: at };

    const { initiative } = confirmInitiative(anInitiative(ON_FULL), tasks, branched);

    expect(initiative).toMatchObject({
      state: "active",
      pipelineId: "full",
      shortName: "sync-it",
      branches: [
        { projectId: "app", madeAt: at },
        { projectId: "api", madeAt: at },
      ],
    });
  });

  it("is refused when a Project its Tasks span, one in Shaping too, has no branch made", () => {
    const branched = { shortName: "sync-it", projectIds: ["api"], madeAt: at };

    expect(refusalOf(() => confirmInitiative(anInitiative(ON_FULL), tasks, branched))).toEqual([
      "The Initiative changed while it was being confirmed; confirm it again.",
    ]);
  });

  it("is refused when its Short name changed after the branches were made", () => {
    const branched = { shortName: "old", projectIds: ["app", "api"], madeAt: at };

    expect(() => confirmInitiative(anInitiative(ON_FULL), tasks, branched)).toThrow(
      InitiativeRefused,
    );
  });

  it("keeps no Short name and makes no branch on None", () => {
    const { initiative } = confirmInitiative(
      anInitiative({ ...SYNC, shortName: "left-over" }),
      tasks,
      undefined,
    );

    expect(initiative.shortName).toBeUndefined();
    expect(initiative.branches).toEqual([]);
  });
});

describe("dropInitiative", () => {
  it("keeps the Initiative's branches", () => {
    const branches = [{ projectId: "app", madeAt: at }];
    const active = anInitiative({ ...ON_FULL, state: "active", branches });

    expect(dropInitiative(active, [], at)?.initiative.branches).toEqual(branches);
  });
});

describe("addBranch", () => {
  const active = anInitiative({
    ...ON_FULL,
    state: "active",
    branches: [{ projectId: "app", madeAt: at }],
  });

  it("keeps the branch made in a Project it comes to span", () => {
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
});

describe("the pipeline edit", () => {
  const active = anInitiative({ ...ON_FULL, state: "active" });

  it("has no problem for another Pipeline", () => {
    expect(initiativeEditProblems(active, { kind: "pipeline", pipelineId: "quick" }, [])).toEqual(
      [],
    );
  });

  it("names the Pipeline it follows already", () => {
    expect(
      initiativeEditProblems(active, { kind: "pipeline", pipelineId: "full" }, [], "Full"),
    ).toEqual(["The Initiative follows Full already."]);
  });

  it("is refused for None", () => {
    expect(initiativeEditProblems(active, { kind: "pipeline", pipelineId: null }, [])).toEqual([
      "Whether the Initiative has a Pipeline was fixed at Confirm.",
    ]);
  });
});

describe("initiativePipelineProblems", () => {
  const pipeline = { name: "Full", keys: ["test", "lint"], hasGate: true };

  it("names each missing command and its Project", () => {
    expect(
      initiativePipelineProblems(pipeline, [
        { name: "App", commands: [{ key: "test" }, { key: "lint" }] },
        { name: "Api", commands: [{ key: "test" }] },
      ]),
    ).toEqual([
      "The Pipeline Full runs lint, which Api has no command for. Add it on the Project page, or choose another Pipeline.",
    ]);
  });

  it("refuses the CTO's Proposal when a spanned Project lacks a command", () => {
    const active = anInitiative({ ...ON_FULL, state: "active" });

    expect(
      initiativePipelineChangeProblems(active, "lint-first", pipeline, [
        { name: "Api", commands: [] },
      ]),
    ).toEqual([
      "The Pipeline Full runs test and lint, which Api has no commands for. Add them on the Project page, or choose another Pipeline.",
    ]);
  });
});

describe("what the CTO and read_initiative read of the Initiative's Pipeline", () => {
  const pipelines = [
    { id: "full", name: "Full", description: "For most work.", stages: [{ name: "Implement" }] },
  ];

  it("names the Pipeline, the Short name and the branch in each Project", () => {
    const active = anInitiative({
      ...ON_FULL,
      state: "active",
      branches: [{ projectId: "app", madeAt: at }],
    });

    expect(initiativePipelineLines(active, "Full")).toEqual([
      "- Initiative's Pipeline: Full (full)",
      "- Short name: sync-it",
      `- Initiative's branch initiative/sync-it in the Project app, made on ${at.toISOString()}`,
    ]);
    expect(initiativePipelineLines(anInitiative(SYNC), undefined)).toEqual([
      "- Initiative's Pipeline: None, so each Task publishes on its own",
    ]);
  });

  it("lists the library in the shaping Brief, saying the Initiative is on None until one is chosen", () => {
    const brief = shapingBrief(anInitiative(SYNC), "The record.", pipelines);

    expect(brief).toContain("The record.");
    expect(brief).toContain("The Initiative's Pipeline is None");
    expect(brief).toContain("whether it has one is fixed at Confirm");
    expect(brief).toContain("- full: Full (Implement). For most work.");
  });
});
