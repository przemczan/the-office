import type { Role, Stage, StageRun, TaskStage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { NO_TOKENS } from "../../shell/token-words.ts";
import {
  currentStageIndex,
  railCaption,
  railRunsWords,
  railStateWords,
  stagesOnRail,
  stageWorkerWords,
} from "./stage-rail-words.ts";
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
  onFailure: { goBackTo: "implement", rounds: 3 },
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
    threadId: null,
    session: null,
    tokens: NO_TOKENS,
    carriedFailure: null,
    sentBack: null,
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

describe("railCaption", () => {
  const waiting = [
    aTaskStage(implement, { state: "done", runs: [aRun()] }),
    aTaskStage(tests, { state: "waiting-on-you", runs: [aRun()] }),
  ];

  it("says the Task hasn't started until a Stage ran, a Task dropped before that too", () => {
    for (const state of ["backlog", "planning", "ready", "dropped"] as const) {
      expect(railCaption([aTaskStage(implement)], state)).toBe("Not started");
    }
  });

  it("names the Stage holding the walk and its state", () => {
    expect(railCaption(waiting, "in-progress")).toBe("At Tests: waiting on you");
  });

  it("counts skipped Stages as finished between two Stages", () => {
    const stages = [
      aTaskStage(implement, { state: "done", runs: [aRun()] }),
      aTaskStage(tests, { state: "skipped", runs: [aRun()] }),
      aTaskStage(review),
    ];
    expect(railCaption(stages, "in-progress")).toBe("2 of 3 Stages finished");
  });

  it("says all finished on a done Task", () => {
    expect(railCaption(waiting, "done")).toBe("All 2 Stages finished");
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
  it("has words for all eight Stage states", () => {
    const states = Object.keys(STAGE_STATE_WORDS) as TaskStage["state"][];
    expect(states).toHaveLength(8);
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

  it("counts runs and their time", () => {
    const done = aTaskStage(tests, { state: "done", runs: [aRun(), aRun({ number: 2 })] });
    expect(railRunsWords(done, true, now)).toBe("2 runs · 36 min");
  });

  it("counts a running Stage's time until now", () => {
    const running = aTaskStage(tests, { state: "running", runs: [aRun({ endedAt: null })] });
    expect(railRunsWords(running, true, now)).toBe("1 run · 30 min so far");
  });
});
