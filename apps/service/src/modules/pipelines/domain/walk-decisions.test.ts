import { describe, expect, it } from "vitest";
import type { Stage } from "./stage.js";
import {
  NO_STAGE_TOKENS,
  type StageOutcome,
  type StageRun,
  type StageRunDecision,
} from "./stage-run.js";
import { acceptedIssues, walkAnswerOf, walkDecision } from "./walk-decisions.js";

const implement: Stage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Build it.",
  session: "fresh",
  budget: 100_000,
};
const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
  onFailure: { goBackTo: "implement", rounds: 3 },
};

function aRun(
  stageKey: string,
  outcome: StageOutcome,
  decisions: StageRunDecision[] = [],
): StageRun {
  return {
    id: `run-${stageKey}`,
    taskId: "task-1",
    stageKey,
    number: 1,
    carriedFailure: undefined,
    threadId: "thread-1",
    session: "fresh",
    headCommit: undefined,
    commandRuns: [],
    tokens: NO_STAGE_TOKENS,
    decisions,
    heldBy: undefined,
    sentBack: undefined,
    gateAction: undefined,
    outcome,
    startedAt: new Date(0),
    endedAt: new Date(0),
  };
}

const failed: StageOutcome = { status: "failed", error: "2 tests fail.\n\nThe output." };

describe("walkDecision", () => {
  it("offers a failed loop more rounds, its issues recorded, or dropping the Task", () => {
    const decision = walkDecision(aRun("tests", failed), {
      kind: "no-retries-left",
      stage: tests,
      error: "2 tests fail.",
    });

    expect(decision).toMatchObject({
      kind: "no-retries-left",
      draft: {
        question: '"Tests" failed, and its rounds are used up. What now?',
        options: ["Allow 3 more rounds", "Continue with the issues recorded", "Drop the Task"],
        recommendation: { option: 0 },
      },
      options: [{ kind: "more-rounds", rounds: 3 }, { kind: "accept-issues" }, { kind: "drop" }],
    });
    expect(decision.draft.context).toContain("2 tests fail.");
    expect(decision.draft.context).toContain("your answer guides one more round");
  });

  it("offers a failed Stage without a loop one more round of its own", () => {
    const decision = walkDecision(aRun("implement", failed), {
      kind: "no-retries-left",
      stage: implement,
      error: "The session ended.",
    });

    expect(decision.draft.question).toBe(
      '"Implement" failed, with no round to go back to. What now?',
    );
    expect(decision.draft.options[0]).toBe('Run "Implement" once more');
    expect(decision.options[0]).toEqual({ kind: "one-more-round", guidance: undefined });
  });

  it("names the statements not reported met at the end of the Pipeline", () => {
    const decision = walkDecision(aRun("implement", { status: "done", summary: "Done." }), {
      kind: "definition-of-done",
      unmet: ["The name persists"],
      again: implement,
    });

    expect(decision).toMatchObject({
      kind: "definition-of-done",
      draft: {
        options: ['Run "Implement" once more', "Mark the Task Done", "Drop the Task"],
      },
      options: [
        { kind: "one-more-round", guidance: undefined },
        { kind: "mark-done" },
        { kind: "drop" },
      ],
    });
    expect(decision.draft.context).toContain("Not reported met:\n- The name persists");
  });

  it("asks whether to run again a Stage The Office restarted during, or drop the Task", () => {
    const error =
      "The Office restarted during this Stage. The Office discarded the Stage's uncommitted edits to 1 file.";
    const restarted = aRun("implement", { status: "failed", error, interrupted: "restart" });

    const decision = walkDecision(restarted, { kind: "restart", stage: implement });

    expect(decision).toMatchObject({
      kind: "restart",
      draft: {
        question: 'The Office restarted during "Implement". Run it again?',
        options: ['Run "Implement" again', "Drop the Task"],
        recommendation: { option: 0 },
      },
      options: [{ kind: "one-more-round", guidance: undefined }, { kind: "drop" }],
    });
    expect(decision.draft.context).toContain(error);
    const ownWords = { kind: "free-answer", text: " Keep the dialog small. " } as const;
    expect(walkAnswerOf({ id: "d-1", ...decision, answer: undefined }, ownWords)).toEqual({
      kind: "one-more-round",
      guidance: "Keep the dialog small.",
    });
  });
});

describe("walkAnswerOf", () => {
  const noRetries: StageRunDecision = {
    id: "decision-1",
    kind: "no-retries-left",
    options: [{ kind: "more-rounds", rounds: 3 }, { kind: "accept-issues" }, { kind: "drop" }],
    answer: undefined,
  };

  it("does what the chosen option does", () => {
    expect(walkAnswerOf(noRetries, { kind: "option", option: 1 })).toEqual({
      kind: "accept-issues",
    });
  });

  it("takes the user's own words as guidance for one more round", () => {
    expect(walkAnswerOf(noRetries, { kind: "free-answer", text: " Mock the clock. " })).toEqual({
      kind: "one-more-round",
      guidance: "Mock the clock.",
    });
  });

  it("takes any answer to the Agent's question as its answer", () => {
    const agent: StageRunDecision = {
      ...noRetries,
      kind: "agent",
      question: "Which page?",
      options: [],
    };

    expect(walkAnswerOf(agent, { kind: "free-answer", text: "The list." })).toEqual({
      kind: "answered",
      answer: "The list.",
    });
  });

  it("refuses an option the Decision doesn't have", () => {
    expect(() => walkAnswerOf(noRetries, { kind: "option", option: 5 })).toThrow(/no option 5/);
  });
});

describe("acceptedIssues", () => {
  it("lists each failure the user continued with, by its Stage's name", () => {
    const accepted: StageRunDecision = {
      id: "decision-1",
      kind: "no-retries-left",
      options: [],
      answer: { kind: "accept-issues" },
    };
    const dropped: StageRunDecision = { ...accepted, answer: { kind: "drop" } };

    expect(
      acceptedIssues(
        [implement, tests],
        [aRun("tests", failed, [accepted]), aRun("implement", failed, [dropped])],
      ),
    ).toEqual([{ stageName: "Tests", error: "2 tests fail.\n\nThe output." }]);
  });

  it("lists a Publish the user continued without, as the base had moved on", () => {
    const publish: Stage = {
      kind: "script",
      key: "publish",
      name: "Publish",
      optional: false,
      command: "publish",
    };
    const moved: StageOutcome = {
      status: "failed",
      error: "main on origin moved on.",
      baseMoved: { conflictedFiles: [] },
    };
    const continued: StageRunDecision = {
      id: "decision-1",
      kind: "base-moved",
      options: [],
      answer: { kind: "accept-issues" },
    };

    expect(acceptedIssues([publish], [aRun("publish", moved, [continued])])).toEqual([
      { stageName: "Publish", error: "main on origin moved on." },
    ]);
  });
});

describe("the base-moved Decision", () => {
  it("offers to run Publish again, to continue without publishing, or to drop the Task", () => {
    const publish: Stage = {
      kind: "script",
      key: "publish",
      name: "Publish",
      optional: false,
      command: "publish",
    };
    const error =
      "office/task-1 no longer applies cleanly on main on origin: merging it would conflict in\n- src/index.ts";
    const run = aRun("publish", {
      status: "failed",
      error,
      baseMoved: { conflictedFiles: ["src/index.ts"] },
    });

    expect(walkDecision(run, { kind: "base-moved", stage: publish, error })).toEqual({
      kind: "base-moved",
      draft: {
        question:
          "\"Publish\" can't publish: the Task's branch conflicts with the base branch. What now?",
        context: `${error}\n\nThe Office resolves no conflicts between Tasks, and no Agent can merge or rebase. "Publish" can run again once the base branch no longer conflicts with the branch.`,
        options: ['Run "Publish" again', "Continue without publishing", "Drop the Task"],
        recommendation: {
          option: 0,
          reason: "The branch keeps the Task's work; it publishes once the conflict is gone.",
        },
      },
      options: [
        { kind: "one-more-round", guidance: undefined },
        { kind: "accept-issues" },
        { kind: "drop" },
      ],
    });
  });
});

describe("the budget Decision", () => {
  const reached = { used: 300_000, budget: 250_000 };

  it("raises the budget from the tokens used, by the Stage's own budget", () => {
    const decision = walkDecision(aRun("implement", failed), {
      kind: "budget",
      stage: implement,
      reached,
    });

    expect(decision).toMatchObject({
      kind: "budget",
      draft: {
        question:
          '"Implement" reached its budget: the Task has used 300k tokens of 250k. Raise it?',
        context: expect.stringContaining(
          "The budget counts the input, output and cache-write tokens of the Task's Threads so far, leaving out cache reads.",
        ),
        options: ["Raise it to 400k", "Drop the Task"],
      },
      options: [{ kind: "raise-budget", tokens: 150_000 }, { kind: "drop" }],
    });
  });

  it("takes the user's own words as raising it", () => {
    const decision: StageRunDecision = {
      id: "decision-1",
      kind: "budget",
      options: [{ kind: "raise-budget", tokens: 150_000 }, { kind: "drop" }],
      answer: undefined,
    };

    expect(walkAnswerOf(decision, { kind: "free-answer", text: "Go on." })).toEqual({
      kind: "raise-budget",
      tokens: 150_000,
    });
  });
});
