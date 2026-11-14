import type { Role, Stage, StageRun, TaskStage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { NO_TOKENS } from "../../shell/token-words.ts";
import {
  currentStageIndex,
  railScrollLeft,
  loopBackEnds,
  loopBackPath,
  loopBacks,
  loopBackWords,
  railCaption,
  railRunsWords,
  railStateWords,
  stagesOnRail,
  stageWaitsForRunEnvironment,
  stageWorkerWords,
  stoppedAtCurrentStage,
  type LoopBack,
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
    waitingSince: null,
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
      expect(railCaption([aTaskStage(implement)], state)).toBe("Not started");
    }
  });

  it("says what Planning waits on before the Task can start", () => {
    expect(railCaption([aTaskStage(implement)], "planning")).toBe(
      "Starts once you confirm the Plan, the Definition of Done and the Pipeline",
    );
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

  it("says a running Stage waits for a run environment until its command starts", () => {
    const waiting = aTaskStage(tests, {
      state: "running",
      runs: [aRun({ endedAt: null, waitingSince: "2026-10-26T10:20:00.000Z" })],
    });
    const started = aTaskStage(tests, { state: "running", runs: [aRun({ endedAt: null })] });

    expect(railStateWords(waiting, names)).toBe("Waiting for a run environment");
    expect(stageWaitsForRunEnvironment(waiting)).toBe(true);
    expect(railCaption([waiting], "in-progress")).toBe("At Tests: waiting for a run environment");
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

  it("counts runs and their time", () => {
    const done = aTaskStage(tests, { state: "done", runs: [aRun(), aRun({ number: 2 })] });
    expect(railRunsWords(done, true, now)).toBe("2 runs · 36m");
  });

  it("counts a running Stage's time until now", () => {
    const running = aTaskStage(tests, { state: "running", runs: [aRun({ endedAt: null })] });
    expect(railRunsWords(running, true, now)).toBe("1 run · 30m so far");
  });
});

function carried(stageKey: string, round: number, rounds = 3): StageRun["carriedFailure"] {
  return { stageKey, round, rounds };
}

describe("loopBacks", () => {
  const failedOutcome = {
    status: "failed",
    error: "A test failed.",
    budgetReached: null,
    interrupted: null,
    refusedTurn: null,
    afterPublishingFailed: null,
    handoverNote: null,
  } as const;
  const lint: Stage = { ...tests, key: "lint", name: "Lint" };
  it("finds none on a walk that never went back", () => {
    const stages = [
      aTaskStage(implement, { runs: [aRun({ number: 1 })] }),
      aTaskStage(tests, { runs: [aRun({ number: 2 })] }),
    ];
    expect(loopBacks(stages)).toEqual([]);
  });

  it("counts each trip from the failing Stage back to the earlier one", () => {
    const stages = [
      aTaskStage(implement, {
        runs: [
          aRun({ number: 1 }),
          aRun({ number: 3, carriedFailure: carried("tests", 1) }),
          aRun({ number: 5, carriedFailure: carried("tests", 2) }),
        ],
      }),
      aTaskStage(tests, {
        runs: [
          aRun({ number: 2, outcome: failedOutcome }),
          aRun({ number: 4, outcome: failedOutcome }),
        ],
      }),
    ];
    expect(loopBacks(stages)).toEqual([
      { from: "tests", to: "implement", fromIndex: 1, toIndex: 0, count: 2, rounds: 3, level: 0 },
    ]);
    expect(loopBackWords(loopBacks(stages)[0]!, names)).toBe(
      "Tests failed and went back to Implement 2 times, of at most 3",
    );
  });

  it("doesn't count a run resumed with the failure it already carried", () => {
    const stages = [
      aTaskStage(implement, {
        runs: [
          aRun({ number: 1 }),
          aRun({ number: 3, carriedFailure: carried("tests", 1) }),
          aRun({ number: 4, carriedFailure: carried("tests", 1) }),
        ],
      }),
      aTaskStage(tests, { runs: [aRun({ number: 2, outcome: failedOutcome })] }),
    ];
    expect(loopBacks(stages).map(({ count }) => count)).toEqual([1]);
  });

  it("takes the rounds of the latest trip, as the user may have allowed more", () => {
    const stages = [
      aTaskStage(implement, {
        runs: [
          aRun({ number: 2, carriedFailure: carried("tests", 1, 1) }),
          aRun({ number: 4, carriedFailure: carried("tests", 2, 2) }),
        ],
      }),
      aTaskStage(tests, { runs: [aRun({ number: 1 }), aRun({ number: 3 })] }),
    ];
    expect(loopBacks(stages).map(({ rounds }) => rounds)).toEqual([2]);
  });

  it("puts a shorter loop under a longer one", () => {
    const stages = [
      aTaskStage(implement, {
        runs: [aRun({ number: 5, carriedFailure: carried("lint", 1) })],
      }),
      aTaskStage(tests, {
        runs: [aRun({ number: 1 }), aRun({ number: 3, carriedFailure: carried("review", 1) })],
      }),
      aTaskStage(review, { runs: [aRun({ number: 2 })] }),
      aTaskStage(lint, { runs: [aRun({ number: 4 })] }),
    ];
    expect(loopBacks(stages).map(({ from, to, level }) => [from, to, level])).toEqual([
      ["review", "tests", 0],
      ["lint", "implement", 1],
    ]);
  });

  it("gives each arc the lowest height free of the arcs it overlaps", () => {
    // The work of Task 2a6dd41c: each failing Stage went back, the last twice, to 4 and then to 2.
    const eight = ["a", "b", "c", "d", "e", "f", "g", "h"].map((key) =>
      aTaskStage({ ...implement, key, name: key }),
    );
    const trips: readonly (readonly [from: number, to: number])[] = [
      [1, 0],
      [3, 2],
      [5, 4],
      [7, 4],
      [7, 2],
    ];
    const stages = eight.map((taskStage, index) => ({
      ...taskStage,
      runs: trips.flatMap(([from, to], trip) => [
        ...(index === from ? [aRun({ number: trip * 2 + 1 })] : []),
        ...(index === to
          ? [aRun({ number: trip * 2 + 2, carriedFailure: carried(eight[from]!.stage.key, 1) })]
          : []),
      ]),
    }));

    expect(
      loopBacks(stages).map(({ fromIndex, toIndex, level }) => [fromIndex, toIndex, level]),
    ).toEqual([
      [1, 0, 0],
      [3, 2, 0],
      [5, 4, 0],
      [7, 4, 1],
      [7, 2, 2],
    ]);
  });

  it("keeps an arc leaving a Stage at the height of one landing there, as they don't overlap", () => {
    const stages = [
      aTaskStage(implement, { runs: [aRun({ number: 5, carriedFailure: carried("tests", 1) })] }),
      aTaskStage(tests, {
        runs: [aRun({ number: 3, carriedFailure: carried("review", 1) }), aRun({ number: 4 })],
      }),
      aTaskStage(review, { runs: [aRun({ number: 2 })] }),
    ];

    expect(loopBacks(stages).map(({ level }) => level)).toEqual([0, 0]);
  });

  it("draws nothing for a Stage run again in place, or for a Stage no longer on the rail", () => {
    const stages = [
      aTaskStage(implement, {
        runs: [aRun({ number: 2, carriedFailure: carried("gone", 1) })],
      }),
      aTaskStage(tests, {
        runs: [aRun({ number: 3 }), aRun({ number: 4, carriedFailure: carried("tests", 1, 1) })],
      }),
    ];
    expect(loopBacks(stages)).toEqual([]);
  });

  it("draws no arc for a Gate's send-back", () => {
    const stages = [
      aTaskStage(implement, {
        runs: [
          aRun({ number: 1 }),
          aRun({ number: 3, sentBack: { gateKey: "review", feedback: "Bigger." } }),
        ],
      }),
      aTaskStage(review, { runs: [aRun({ number: 2 })] }),
    ];
    expect(loopBacks(stages)).toEqual([]);
  });
});

describe("loopBackPath", () => {
  it("goes up at the failing Stage, across at its level and down on the earlier Stage", () => {
    // Four Stages: their centres at 12.5%, 37.5%, 62.5% and 87.5% of the rail.
    const path = loopBackPath({ fromIndex: 3, toIndex: 1, level: 0 }, 4, 42);

    expect(path).toEqual({
      leaves: { share: 12.5, offset: 4 },
      landsOn: { share: 37.5, offset: 6 },
      top: 18,
      height: 22,
    });
  });

  it("draws a longer loop higher, landing on the same spot as the shorter", () => {
    const shorter = loopBackPath({ fromIndex: 2, toIndex: 1, level: 0 }, 4, 58);
    const longer = loopBackPath({ fromIndex: 3, toIndex: 1, level: 1 }, 4, 58);

    expect(longer.top).toBeLessThan(shorter.top);
    expect(longer.top + longer.height).toBe(shorter.top + shorter.height);
    expect(longer.landsOn).toEqual(shorter.landsOn);
  });
});

function loop(fromIndex: number, toIndex: number, level: number): LoopBack {
  return {
    from: `stage-${fromIndex}`,
    to: `stage-${toIndex}`,
    fromIndex,
    toIndex,
    count: 1,
    rounds: 3,
    level,
  };
}

describe("loopBackEnds", () => {
  it("gives each loop its own ends while they share no spot", () => {
    const ends = loopBackEnds([loop(1, 0, 0), loop(3, 2, 0)], 4, 42);

    expect(ends.map(({ key }) => key)).toEqual(["leaves-1", "lands-0", "leaves-3", "lands-2"]);
  });

  it("draws one line for the loops landing on a Stage, as high as the highest", () => {
    const [low, high] = [loop(2, 1, 0), loop(3, 1, 1)];
    const { top, height } = loopBackPath(high, 4, 58);

    expect(loopBackEnds([high, low], 4, 58).filter(({ kind }) => kind === "lands")).toEqual([
      { key: "lands-1", kind: "lands", place: { share: 37.5, offset: 6 }, top, height },
    ]);
  });

  it("draws one line for the loops leaving a Stage, as high as the highest", () => {
    const [low, high] = [loop(3, 2, 0), loop(3, 0, 1)];
    const { top, height } = loopBackPath(high, 4, 58);

    expect(loopBackEnds([low, high], 4, 58).filter(({ kind }) => kind === "leaves")).toEqual([
      { key: "leaves-3", kind: "leaves", place: { share: 12.5, offset: 4 }, top, height },
    ]);
  });
});
