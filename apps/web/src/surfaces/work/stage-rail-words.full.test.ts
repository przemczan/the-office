import type { Role, Stage, StageRun, TaskStage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { NO_TOKENS } from "../../shell/token-words.ts";
import {
  currentStageIndex,
  railScrollLeft,
  railCaption,
  railRunsWords,
  railStateWords,
  stagesOnRail,
  stageWaitsForRunEnvironment,
  stageWorkerWords,
  stoppedAtCurrentStage,
  workingRoleKey,
} from "./stage-rail-words.ts";
import { pipelineProgress } from "./pipeline-progress.ts";
import { stageNamesOf, STAGE_STATE_WORDS } from "./stage-words.ts";

const implement: Stage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Do it.",
  session: "fresh",
  budget: 250_000,
};
const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
  routes: [
    {
      to: "implement",
      condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "failed" }] },
      limit: 3,
    },
    { to: null, condition: null, limit: null },
  ],
};
const review: Stage = { kind: "gate", key: "review", name: "Review", optional: false };
const names = stageNamesOf([implement, tests, review]);
const now = new Date("2026-10-26T10:30:00.000Z");

function aRun(fields: Partial<StageRun> = {}): StageRun {
  return {
    id: "8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e9f",
    number: 1,
    startedAt: "2026-10-26T10:00:00.000Z",
    endedAt: "2026-10-26T10:18:00.000Z",
    waitingSince: null,
    threadId: null,
    session: null,
    engine: null,
    engineSwitches: [],
    tokens: NO_TOKENS,
    context: null,
    carriedFailure: null,
    route: null,
    choice: null,
    sentBack: null,
    restart: null,
    restarted: null,
    startedOver: null,
    earlierStart: false,
    gateAction: null,
    commandRuns: [],
    outcome: null,
    ...fields,
  };
}

function aTaskStage(stage: Stage, fields: Partial<TaskStage> = {}): TaskStage {
  return { stage, state: "pending", tokens: NO_TOKENS, wentBack: null, runs: [], ...fields };
}

describe("stagesOnRail", () => {
  it("reads the library Pipeline until the Task has its own copy", () => {
    expect(stagesOnRail(null, [implement, tests])).toEqual([
      aTaskStage(implement),
      aTaskStage(tests),
    ]);
  });

  it("prefers the Task's copy", () => {
    const own = [aTaskStage(implement, { state: "done", runs: [aRun()] })];
    expect(stagesOnRail(own, [implement, tests])).toBe(own);
  });

  it("has nothing to draw once the library lost the Pipeline", () => {
    expect(stagesOnRail(null, undefined)).toEqual([]);
  });
});

describe("railScrollLeft", () => {
  it("centres the Stage's column in the rail's view", () => {
    expect(railScrollLeft(3, 6, 900, 300)).toBe(375);
  });
});

describe("currentStageIndex", () => {
  it("is nowhere before any Stage ran", () => {
    expect(currentStageIndex([aTaskStage(implement), aTaskStage(tests)])).toBe(-1);
  });

  it("stops at the Stage holding the walk", () => {
    const stages = [
      aTaskStage(implement, { state: "done", runs: [aRun()] }),
      aTaskStage(tests, { state: "paused", runs: [aRun()] }),
      aTaskStage(review),
    ];
    expect(currentStageIndex(stages)).toBe(1);
  });

  it("falls back to the last Stage that ran", () => {
    const stages = [
      aTaskStage(implement, { state: "done", runs: [aRun()] }),
      aTaskStage(tests, { state: "done", runs: [aRun()] }),
      aTaskStage(review),
    ];
    expect(currentStageIndex(stages)).toBe(1);
  });
});

describe("stoppedAtCurrentStage", () => {
  it("is true when the Stage holding the walk was stopped", () => {
    const stages = [
      aTaskStage(implement, { state: "done", runs: [aRun()] }),
      aTaskStage(tests, { state: "stopped", runs: [aRun()] }),
    ];

    expect(stoppedAtCurrentStage(stages)).toBe(true);
  });

  it("is false when the walk is held at a Stage the user paused", () => {
    expect(stoppedAtCurrentStage([aTaskStage(implement, { state: "paused" })])).toBe(false);
  });

  it("goes by the Stage the walk has reached, not one stopped further on", () => {
    const stages = [
      aTaskStage(implement, { state: "paused", runs: [aRun()] }),
      aTaskStage(tests, { state: "stopped", runs: [aRun()] }),
    ];

    expect(stoppedAtCurrentStage(stages)).toBe(false);
  });

  it("is false before any Stage ran", () => {
    expect(stoppedAtCurrentStage([aTaskStage(implement)])).toBe(false);
    expect(stoppedAtCurrentStage([])).toBe(false);
  });
});

describe("railCaption", () => {
  const waiting = [
    aTaskStage(implement, { state: "done", runs: [aRun()] }),
    aTaskStage(tests, { state: "waiting-on-you", runs: [aRun()] }),
  ];

  it("says the Task hasn't started until a Stage ran, a Task dropped before that too", () => {
    for (const state of ["backlog", "ready", "dropped"] as const) {
      expect(railCaption(pipelineProgress([aTaskStage(implement)], state), state)).toBe(
        "Not started",
      );
    }
  });

  it("says what Planning waits on before the Task can start", () => {
    expect(railCaption(pipelineProgress([aTaskStage(implement)], "planning"), "planning")).toBe(
      "Starts once you confirm the Plan, the Definition of Done and the Pipeline",
    );
  });

  it("names the Stage holding the walk and its state", () => {
    expect(railCaption(pipelineProgress(waiting, "in-progress"), "in-progress")).toBe(
      "At Tests: waiting on you",
    );
  });

  it("counts skipped Stages as finished between two Stages", () => {
    const stages = [
      aTaskStage(implement, { state: "done", runs: [aRun()] }),
      aTaskStage(tests, { state: "skipped", runs: [aRun()] }),
      aTaskStage(review),
    ];
    expect(railCaption(pipelineProgress(stages, "in-progress"), "in-progress")).toBe(
      "2 of 3 Stages finished",
    );
  });

  it("says all finished on a done Task", () => {
    expect(railCaption(pipelineProgress(waiting, "done"), "done")).toBe("All 2 Stages finished");
  });

  it("leaves Stages the walk's path no longer reaches out of its counts", () => {
    const stages = [
      aTaskStage(implement, { state: "done", runs: [aRun()] }),
      aTaskStage(tests, { state: "not-taken" }),
      aTaskStage(review),
    ];
    expect(railCaption(pipelineProgress(stages, "in-progress"), "in-progress")).toBe(
      "1 of 2 Stages finished",
    );

    const done = [
      aTaskStage(implement, { state: "done", runs: [aRun()] }),
      aTaskStage(tests, { state: "not-taken" }),
      aTaskStage(review, { state: "done", runs: [aRun()] }),
    ];
    expect(railCaption(pipelineProgress(done, "done"), "done")).toBe("All 2 Stages finished");
  });
});

describe("stageWorkerWords", () => {
  const dana = { key: "developer", card: { name: "Dana" } } as Pick<Role, "key" | "card">;

  it("names the person of an Agent Stage, or nobody", () => {
    expect(stageWorkerWords(aTaskStage(implement), [dana])).toBe("Dana");
    expect(stageWorkerWords(aTaskStage(implement), [])).toBe("Nobody yet");
  });

  it("names the user at a Gate", () => {
    expect(stageWorkerWords(aTaskStage(review), [dana])).toBe("You");
  });

  it("names who works a duty's Stage, or that nobody holds the duty", () => {
    const implementing: Stage = { ...implement, role: undefined, duty: "implements" };
    expect(stageWorkerWords(aTaskStage(implementing, { workedBy: "developer" }), [dana])).toBe(
      "Dana",
    );
    expect(stageWorkerWords(aTaskStage(implementing, { workedBy: null }), [dana])).toBe(
      "Implements · nobody holds it",
    );
    expect(stageWorkerWords(aTaskStage(implementing), [dana])).toBe("Implements");
    expect(workingRoleKey(aTaskStage(implementing, { workedBy: "developer" }))).toBe("developer");
    expect(workingRoleKey(aTaskStage(implement))).toBe("developer");
  });

  it("names a Script Stage's command once it ran it", () => {
    expect(stageWorkerWords(aTaskStage(tests), [dana])).toBe("Project command");
    const ran = aRun({
      commandRuns: [
        { purpose: "command", commandLine: "npm test", outcome: "passed", durationMs: 1000 },
      ],
    });
    expect(stageWorkerWords(aTaskStage(tests, { runs: [ran] }), [dana])).toBe("npm test");
  });
});

describe("railStateWords", () => {
  it("has words for all nine Stage states", () => {
    const states = Object.keys(STAGE_STATE_WORDS) as TaskStage["state"][];
    expect(states).toHaveLength(9);
    for (const state of states) {
      expect(railStateWords(aTaskStage(tests, { state }), names)).toBe(STAGE_STATE_WORDS[state]);
    }
  });

  it("says where a failure went back to", () => {
    const failed = aTaskStage(tests, {
      state: "failed",
      wentBack: { stageKey: "implement", round: 1, rounds: 3 },
    });
    expect(railStateWords(failed, names)).toBe("Failed · went back to Implement");
  });

  it("says a running Stage waits for a run environment until its command starts", () => {
    const waiting = aTaskStage(tests, {
      state: "running",
      runs: [aRun({ endedAt: null, waitingSince: "2026-10-26T10:20:00.000Z" })],
    });
    const started = aTaskStage(tests, { state: "running", runs: [aRun({ endedAt: null })] });

    expect(railStateWords(waiting, names)).toBe("Waiting for a run environment");
    expect(stageWaitsForRunEnvironment(waiting)).toBe(true);
    expect(railCaption(pipelineProgress([waiting], "in-progress"), "in-progress")).toBe(
      "At Tests: waiting for a run environment",
    );
    expect(railStateWords(started, names)).toBe("Running");
    expect(stageWaitsForRunEnvironment(started)).toBe(false);
  });
});

describe("railRunsWords", () => {
  it("tells a Task not started from a Stage not reached", () => {
    expect(railRunsWords(aTaskStage(tests), false, now)).toBe("Not started");
    expect(railRunsWords(aTaskStage(tests), true, now)).toBe("Not run yet");
  });

  it("says a skipped Stage wasn't needed", () => {
    const skipped = aTaskStage(tests, { state: "skipped", runs: [aRun()] });
    expect(railRunsWords(skipped, true, now)).toBe("Not needed");
  });

  it("says a Stage the walk's path no longer reaches is Not taken and won't run", () => {
    const notTaken = aTaskStage(tests, { state: "not-taken" });
    expect(railStateWords(notTaken, names)).toBe("Not taken");
    expect(railRunsWords(notTaken, true, now)).toBe("Not run");
  });

  it("counts runs and their time", () => {
    const done = aTaskStage(tests, { state: "done", runs: [aRun(), aRun({ number: 2 })] });
    expect(railRunsWords(done, true, now)).toBe("2 runs · 36m");
  });

  it("counts a running Stage's time until now", () => {
    const running = aTaskStage(tests, { state: "running", runs: [aRun({ endedAt: null })] });
    expect(railRunsWords(running, true, now)).toBe("1 run · 30m so far");
  });
});
