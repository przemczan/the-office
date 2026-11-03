import type { Attachment, Stage, StageRun, TaskStage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { NO_TOKENS } from "../token-words.ts";
import { attachmentRounds, roundName, type AttachmentRound } from "./attachment-rounds.ts";

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
