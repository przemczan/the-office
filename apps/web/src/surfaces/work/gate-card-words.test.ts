import type {
  Attachment,
  ChangedFile,
  Stage,
  StageRun,
  TaskStage,
  TestResult,
  TestResultState,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { NO_TOKENS } from "../../shell/token-words.ts";
import {
  definitionOfDoneFact,
  gateFactsLine,
  gateHeading,
  gateQuestion,
  linesChanged,
  picturesOfThisRound,
  testsBeforeGate,
  testsFact,
} from "./gate-card-words.ts";

function aResult(state: TestResultState): TestResult {
  return { stageKey: state, name: state, state, detail: null };
}

function resultOf(stageKey: string, state: TestResultState): TestResult {
  return { ...aResult(state), stageKey };
}

function stageKeyed(key: string): TaskStage {
  return { stage: { key } } as TaskStage;
}

function aFile(lines: ChangedFile["lines"]): ChangedFile {
  return { path: "a.ts", previousPath: null, lines, deleted: false };
}

function anAttachment(fields: Pick<Attachment, "id" | "kind" | "addedAt">): Attachment {
  return { name: fields.id, ...fields } as Attachment;
}

describe("gateQuestion", () => {
  it("says what Continue moves on to", () => {
    const next = { kind: "gate", key: "publish", name: "Publish", optional: false } as const;
    expect(gateQuestion({ next })).toBe("Look at the changes and let the work continue to Publish");
  });

  it("says the work finishes at the last Stage", () => {
    expect(gateQuestion({ next: undefined })).toBe("Look at the changes and let the work finish");
  });
});

describe("gateHeading", () => {
  const gate = { name: "UI acceptance" } as Stage;

  it("names the Stage the Gate stands before", () => {
    expect(gateHeading({ gate, next: { name: "Publish" } as Stage })).toBe("Before Publish");
  });

  it("names the Gate itself when it is the last Stage", () => {
    expect(gateHeading({ gate, next: undefined })).toBe("UI acceptance");
  });
});

describe("gateFactsLine", () => {
  it("reads the files, the tests and the Definition of Done in a line", () => {
    expect(gateFactsLine(3, [aResult("passed")], "2 of 3")).toBe(
      "3 files changed · tests passed · Definition of Done 2 of 3",
    );
  });

  it("counts one file and one failed test in the singular", () => {
    expect(gateFactsLine(1, [aResult("failed")], "0 of 1")).toBe(
      "1 file changed · 1 test failed · Definition of Done 0 of 1",
    );
  });

  it("leaves the files out until they are known", () => {
    expect(gateFactsLine(undefined, [], "0 of 1")).toBe(
      "tests not run · Definition of Done 0 of 1",
    );
  });
});

describe("testsBeforeGate", () => {
  const stages = ["implement", "tests", "ui-acceptance", "build"].map(stageKeyed);
  const gate = {
    kind: "gate",
    key: "ui-acceptance",
    name: "UI acceptance",
    optional: false,
  } as const;

  it("leaves out a check after the Gate, so a Build still to come reads as Passed", () => {
    const tests = resultOf("tests", "passed");
    const checks = testsBeforeGate([tests, resultOf("build", "not-run")], stages, { gate });
    expect(checks).toEqual([tests]);
    expect(testsFact(checks)).toBe("Passed");
  });

  it("keeps a check before the Gate that didn't run", () => {
    const results = [resultOf("implement", "passed"), resultOf("tests", "not-run")];
    expect(testsFact(testsBeforeGate(results, stages, { gate }))).toBe("Not run");
  });

  it("reads Not run with no check before the Gate", () => {
    const results = [resultOf("build", "passed")];
    expect(testsFact(testsBeforeGate(results, stages, { gate }))).toBe("Not run");
  });
});

describe("testsFact", () => {
  it("reads Passed when the checks that ran passed", () => {
    expect(testsFact([aResult("passed"), aResult("passed")])).toBe("Passed");
  });

  it("counts the failed ones, whatever else passed", () => {
    expect(testsFact([aResult("passed"), aResult("failed"), aResult("failed")])).toBe("2 failed");
  });

  it("reads Not run with no result, and with none that ran", () => {
    expect(testsFact([])).toBe("Not run");
    expect(testsFact([aResult("not-run"), aResult("skipped")])).toBe("Not run");
  });

  it("reads Not run when any check didn't run, however many passed", () => {
    expect(testsFact([aResult("passed"), aResult("not-run")])).toBe("Not run");
    expect(testsFact([aResult("passed"), aResult("skipped")])).toBe("Not run");
  });

  it("still counts a failed one beside a check that didn't run", () => {
    expect(testsFact([aResult("failed"), aResult("not-run")])).toBe("1 failed");
  });
});

describe("linesChanged", () => {
  it("adds up the files' lines, with nothing for a binary file", () => {
    const files = [aFile({ added: 14, removed: 6 }), aFile(null), aFile({ added: 1, removed: 0 })];
    expect(linesChanged(files)).toEqual({ added: 15, removed: 6 });
  });
});

describe("definitionOfDoneFact", () => {
  it("counts the statements Reported met out of all of them", () => {
    const definitionOfDone = ["It exports.", "It keeps the dates.", "The tests pass."];
    expect(definitionOfDoneFact({ definitionOfDone }, [1, 3])).toBe("2 of 3");
    expect(definitionOfDoneFact({ definitionOfDone }, [])).toBe("0 of 3");
  });
});

describe("picturesOfThisRound", () => {
  const gate: Stage = { kind: "gate", key: "look", name: "Look", optional: false };
  const stages: TaskStage[] = [
    {
      stage: gate,
      state: "waiting-on-you",
      tokens: NO_TOKENS,
      wentBack: null,
      runs: [
        {
          number: 1,
          startedAt: "2026-11-04T10:00:00.000Z",
          endedAt: "2026-11-04T11:00:00.000Z",
          gateAction: { kind: "continue" },
        } as StageRun,
        {
          number: 3,
          startedAt: "2026-11-04T11:45:00.000Z",
          endedAt: "2026-11-04T11:45:00.100Z",
          gateAction: null,
        } as StageRun,
      ],
    },
  ];

  it("keeps the waiting run's pictures, without its other Attachments or an earlier run's", () => {
    const attachments = [
      anAttachment({ id: "before", kind: "image", addedAt: "2026-11-04T10:30:00.000Z" }),
      anAttachment({ id: "picture", kind: "image", addedAt: "2026-11-04T11:30:00.000Z" }),
      anAttachment({ id: "notes", kind: "document", addedAt: "2026-11-04T11:31:00.000Z" }),
      anAttachment({ id: "while-it-waits", kind: "image", addedAt: "2026-11-04T13:00:00.000Z" }),
    ];
    expect(picturesOfThisRound(attachments, stages, { gate }).map(({ id }) => id)).toEqual([
      "picture",
      "while-it-waits",
    ]);
  });

  it("has none once the Gate waits no more", () => {
    const attachments = [
      anAttachment({ id: "picture", kind: "image", addedAt: "2026-11-04T11:30:00.000Z" }),
    ];
    const ended = stages.map((taskStage) => ({ ...taskStage, runs: taskStage.runs.slice(0, 1) }));

    expect(picturesOfThisRound(attachments, ended, { gate })).toEqual([]);
  });
});
