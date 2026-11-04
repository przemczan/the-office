import type {
  Attachment,
  ChangedFile,
  StageRun,
  TaskStage,
  TestResult,
  TestResultState,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { NO_TOKENS } from "../../shell/token-words.ts";
import {
  definitionOfDoneFact,
  gateQuestion,
  linesChanged,
  picturesOfThisRound,
  testsFact,
} from "./gate-card-words.ts";

function aResult(state: TestResultState): TestResult {
  return { stageKey: state, name: state, state, detail: null };
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

  it("still reads Passed beside a check placed after the Gate", () => {
    expect(testsFact([aResult("passed"), aResult("not-run")])).toBe("Passed");
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
  const sentBackAt = "2026-11-04T11:00:00.000Z";
  const stages: TaskStage[] = [
    {
      stage: { kind: "gate", key: "look", name: "Look", optional: false },
      state: "waiting-on-you",
      tokens: NO_TOKENS,
      wentBack: null,
      runs: [
        {
          startedAt: "2026-11-04T10:00:00.000Z",
          endedAt: sentBackAt,
          gateAction: { kind: "send-back", stageKey: "implement", feedback: "Bigger." },
        } as StageRun,
      ],
    },
  ];

  it("keeps the current round's pictures, without its other Attachments or the earlier rounds", () => {
    const attachments = [
      anAttachment({ id: "before", kind: "image", addedAt: "2026-11-04T10:30:00.000Z" }),
      anAttachment({ id: "picture", kind: "image", addedAt: "2026-11-04T11:30:00.000Z" }),
      anAttachment({ id: "notes", kind: "document", addedAt: "2026-11-04T11:31:00.000Z" }),
    ];
    expect(picturesOfThisRound(attachments, stages).map(({ id }) => id)).toEqual(["picture"]);
  });
});
