import type { Attachment, Stage, StageRun, TaskStage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { NO_TOKENS } from "../token-words.ts";
import {
  attachmentRounds,
  attachmentsOfGateRun,
  roundName,
  type AttachmentRound,
} from "./attachment-rounds.ts";

const TASK_ID = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";

const implement: Stage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Do it.",
  session: "fresh",
  budget: 100_000,
};
const look: Stage = { kind: "gate", key: "look", name: "UI acceptance", optional: false };

function anImage(name: string, addedAt: string): Attachment {
  return {
    kind: "image",
    id: crypto.randomUUID(),
    owner: { kind: "task", taskId: TASK_ID },
    name,
    addedBy: { kind: "person", roleKey: "developer" },
    addedAt,
    mediaType: "image/png",
    size: 1024,
  };
}

function aRun(
  startedAt: string,
  endedAt: string | null,
  gateAction: StageRun["gateAction"] = null,
): StageRun {
  return {
    id: crypto.randomUUID(),
    number: 1,
    startedAt,
    endedAt,
    waitingSince: null,
    threadId: null,
    session: null,
    tokens: NO_TOKENS,
    carriedFailure: null,
    sentBack: null,
    commandRuns: [],
    gateAction,
    outcome: null,
  };
}

function stageWith(stage: Stage, runs: readonly StageRun[]): TaskStage {
  return { stage, state: "done", tokens: NO_TOKENS, wentBack: null, runs: [...runs] };
}

function sentBack(feedback: string): StageRun["gateAction"] {
  return { kind: "send-back", stageKey: implement.key, feedback };
}

/** Each round by its name, with its Attachments' names and the feedback that started it. */
function shape(rounds: readonly AttachmentRound[]): unknown[] {
  return rounds.map((round) => ({
    name: roundName(round),
    sentBackWith: round.kind === "round" ? round.sentBackWith : undefined,
    attachments: round.attachments.map(({ name }) => name),
  }));
}

describe("attachmentRounds", () => {
  it("is one round of everything, in the order added, while the Task has no Stages", () => {
    const rounds = attachmentRounds(
      [
        anImage("later.png", "2026-10-26T11:00:00.000Z"),
        anImage("first.png", "2026-10-26T10:00:00.000Z"),
      ],
      [],
    );
    expect(shape(rounds)).toEqual([
      { name: "Round 1", sentBackWith: null, attachments: ["first.png", "later.png"] },
    ]);
  });

  it("is one round of everything while no Gate sent the work back", () => {
    const rounds = attachmentRounds(
      [anImage("shot.png", "2026-10-26T10:30:00.000Z")],
      [
        stageWith(implement, [aRun("2026-10-26T10:00:00.000Z", "2026-10-26T10:40:00.000Z")]),
        stageWith(look, [
          aRun("2026-10-26T10:40:00.000Z", "2026-10-26T11:00:00.000Z", { kind: "continue" }),
        ]),
      ],
    );
    expect(shape(rounds)).toEqual([
      { name: "Round 1", sentBackWith: null, attachments: ["shot.png"] },
    ]);
  });

  it("starts a round at a send-back, headed with its feedback", () => {
    const rounds = attachmentRounds(
      [
        anImage("before.png", "2026-10-26T10:30:00.000Z"),
        anImage("at-the-send-back.png", "2026-10-26T11:00:00.000Z"),
        anImage("after.png", "2026-10-26T11:30:00.000Z"),
      ],
      [
        stageWith(implement, [
          aRun("2026-10-26T10:00:00.000Z", "2026-10-26T10:40:00.000Z"),
          aRun("2026-10-26T11:00:00.000Z", "2026-10-26T11:40:00.000Z"),
        ]),
        stageWith(look, [
          aRun("2026-10-26T10:40:00.000Z", "2026-10-26T11:00:00.000Z", sentBack("Bigger buttons.")),
          aRun("2026-10-26T11:40:00.000Z", null),
        ]),
      ],
    );
    expect(shape(rounds)).toEqual([
      { name: "Round 1", sentBackWith: null, attachments: ["before.png", "at-the-send-back.png"] },
      { name: "Round 2", sentBackWith: "Bigger buttons.", attachments: ["after.png"] },
    ]);
  });

  it("keeps a round for each send-back, an empty one too, the current one last", () => {
    const rounds = attachmentRounds(
      [
        anImage("one.png", "2026-10-26T10:30:00.000Z"),
        anImage("two.png", "2026-10-26T11:30:00.000Z"),
      ],
      [
        stageWith(implement, [aRun("2026-10-26T10:00:00.000Z", "2026-10-26T10:40:00.000Z")]),
        stageWith(look, [
          // Out of order, as two Gates' runs may be.
          aRun("2026-10-26T12:00:00.000Z", "2026-10-26T12:10:00.000Z", sentBack("Still wrong.")),
          aRun("2026-10-26T10:40:00.000Z", "2026-10-26T11:00:00.000Z", sentBack("Bigger buttons.")),
        ]),
      ],
    );
    expect(shape(rounds)).toEqual([
      { name: "Round 1", sentBackWith: null, attachments: ["one.png"] },
      { name: "Round 2", sentBackWith: "Bigger buttons.", attachments: ["two.png"] },
      { name: "Round 3", sentBackWith: "Still wrong.", attachments: [] },
    ]);
  });

  it("groups what was added before the first Stage run started on its own", () => {
    const rounds = attachmentRounds(
      [
        anImage("mock-up.png", "2026-10-26T09:00:00.000Z"),
        anImage("shot.png", "2026-10-26T10:30:00.000Z"),
      ],
      [stageWith(implement, [aRun("2026-10-26T10:00:00.000Z", null)])],
    );
    expect(shape(rounds)).toEqual([
      { name: "Before the work started", sentBackWith: undefined, attachments: ["mock-up.png"] },
      { name: "Round 1", sentBackWith: null, attachments: ["shot.png"] },
    ]);
  });
});

const GATE_REACHED = {
  status: "done",
  summary: "The Task reached the Gate and waited for the user.",
  skipped: false,
  definitionOfDoneMet: null,
  pullRequestUrl: null,
  handoverNote: null,
} satisfies StageRun["outcome"];

function namesOf(attachments: readonly Attachment[]): string[] {
  return attachments.map(({ name }) => name);
}

/** A Gate's run the Task waited at. */
function aGateRun(
  number: number,
  startedAt: string,
  endedAt: string,
  gateAction: StageRun["gateAction"] = null,
): StageRun {
  return { ...aRun(startedAt, endedAt, gateAction), number, outcome: GATE_REACHED };
}

describe("attachmentsOfGateRun", () => {
  const workStart = aRun("2026-11-04T09:00:00.000Z", "2026-11-04T09:30:00.000Z");
  const firstRun = aGateRun(2, "2026-11-04T10:00:00.000Z", "2026-11-04T11:00:00.000Z", {
    kind: "continue",
  });
  // As every Gate's run, it ended on reaching the Gate, and goes on waiting for the user.
  const secondRun = aGateRun(4, "2026-11-04T12:00:00.000Z", "2026-11-04T12:00:00.100Z");
  const stages = [stageWith(implement, [workStart]), stageWith(look, [firstRun, secondRun])];

  it("gives a first run everything added until it ended, from before the work started too", () => {
    const attachments = [
      anImage("before the work", "2026-11-04T08:59:59.000Z"),
      anImage("as the work started", "2026-11-04T09:00:00.000Z"),
      anImage("as it ended", "2026-11-04T11:00:00.000Z"),
      anImage("after", "2026-11-04T11:00:01.000Z"),
    ];

    expect(namesOf(attachmentsOfGateRun(attachments, stages, firstRun))).toEqual([
      "before the work",
      "as the work started",
      "as it ended",
    ]);
  });

  it("shows what was added before the work started at the first run only", () => {
    const attachments = [anImage("before the work", "2026-11-04T08:59:59.000Z")];

    expect(attachmentsOfGateRun(attachments, stages, secondRun)).toEqual([]);
  });

  it("gives a later run what came after the previous one ended, though that was a Continue", () => {
    const attachments = [
      anImage("the first run's", "2026-11-04T11:00:00.000Z"),
      anImage("between the two", "2026-11-04T11:30:00.000Z"),
    ];

    expect(namesOf(attachmentsOfGateRun(attachments, stages, secondRun))).toEqual([
      "between the two",
    ]);
  });

  it("skips what another Gate's earlier run showed, and only an earlier one's", () => {
    const secondGate: Stage = { ...look, key: "sign-off", name: "Sign-off" };
    const signOff = aGateRun(3, "2026-11-04T11:30:00.000Z", "2026-11-04T11:40:00.000Z", {
      kind: "continue",
    });
    const twoGates = [...stages, stageWith(secondGate, [signOff])];
    const attachments = [
      anImage("the first Gate's", "2026-11-04T10:30:00.000Z"),
      anImage("the second Gate's", "2026-11-04T11:20:00.000Z"),
      anImage("after both", "2026-11-04T11:50:00.000Z"),
    ];

    expect(namesOf(attachmentsOfGateRun(attachments, twoGates, firstRun))).toEqual([
      "the first Gate's",
    ]);
    expect(namesOf(attachmentsOfGateRun(attachments, twoGates, signOff))).toEqual([
      "the second Gate's",
    ]);
    expect(namesOf(attachmentsOfGateRun(attachments, twoGates, secondRun))).toEqual(["after both"]);
  });

  it("doesn't count an earlier run of a Stage that isn't a Gate", () => {
    const attachments = [anImage("during the work", "2026-11-04T09:10:00.000Z")];
    const onlyTheWork = [stageWith(implement, [workStart]), stageWith(look, [secondRun])];

    expect(namesOf(attachmentsOfGateRun(attachments, onlyTheWork, secondRun))).toEqual([
      "during the work",
    ]);
  });

  it.each([
    ["skipped", { ...GATE_REACHED, skipped: true }],
    [
      "never started",
      {
        status: "failed",
        error: "Restarted.",
        budgetReached: null,
        interrupted: null,
        handoverNote: null,
      },
    ],
  ] satisfies [string, StageRun["outcome"]][])(
    "leaves a %s Gate's run empty, and what it would have shown to the next one",
    (_words, outcome) => {
      const notShown = {
        ...aRun("2026-11-04T11:30:00.000Z", "2026-11-04T11:30:00.000Z"),
        number: 3,
        outcome,
      };
      const secondGate: Stage = { ...look, key: "sign-off", name: "Sign-off" };
      const twoGates = [...stages, stageWith(secondGate, [notShown])];
      const attachments = [anImage("between the two", "2026-11-04T11:20:00.000Z")];

      expect(attachmentsOfGateRun(attachments, twoGates, notShown)).toEqual([]);
      expect(namesOf(attachmentsOfGateRun(attachments, twoGates, secondRun))).toEqual([
        "between the two",
      ]);
    },
  );

  it("keeps adding to a run while it waits, in the order they were added", () => {
    const attachments = [
      anImage("just now", "2026-11-05T09:00:00.000Z"),
      anImage("earlier today", "2026-11-05T08:00:00.000Z"),
    ];

    expect(namesOf(attachmentsOfGateRun(attachments, stages, secondRun))).toEqual([
      "earlier today",
      "just now",
    ]);
  });

  it("keeps every kind of Attachment", () => {
    const addedAt = "2026-11-04T11:30:00.000Z";
    const image = anImage("shot", addedAt);
    const notes = { ...anImage("notes", addedAt), kind: "document" } as Attachment;
    const design = { ...anImage("design.html", addedAt), kind: "file" } as Attachment;
    const spec = { ...anImage("spec", addedAt), kind: "link" } as Attachment;

    expect(
      attachmentsOfGateRun([image, notes, design, spec], stages, secondRun).map(({ kind }) => kind),
    ).toEqual(["image", "document", "file", "link"]);
  });
});
