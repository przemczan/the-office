import { describe, expect, it } from "vitest";
import { RESOLVE_KEY } from "./resolve-stages.js";
import type { Stage } from "./stage.js";
import { type StageOutcome, type StageRunDecision } from "./stage-run.js";
import {
  acceptedIssues,
  asksAConsultantFirst,
  walkAnswerOf,
  walkDecision,
} from "./walk-decisions.js";
import {
  implement,
  tests,
  aRun,
  failed,
  sentBack,
  usedUpRouteBack,
} from "./walk-decisions.fixtures.js";

describe("walkDecision", () => {
  it("names the statements not reported met at the end of the Pipeline", () => {
    const decision = walkDecision(aRun("implement", { status: "done", summary: "Done." }), {
      kind: "definition-of-done",
      unmet: ["The name persists"],
      outOfReach: [],
      again: implement,
      before: undefined,
    });

    expect(decision).toMatchObject({
      kind: "definition-of-done",
      draft: {
        question: "The Pipeline ended, but the Definition of Done isn't reported met. What now?",
        options: ['Run "Implement" once more', "Mark the Task Done", "Drop the Task"],
        recommendation: {
          option: 0,
          reason: "What is left goes into its Brief, so the Agent can finish it.",
        },
      },
      options: [
        { kind: "one-more-round", guidance: undefined },
        { kind: "mark-done" },
        { kind: "drop" },
      ],
    });
    expect(decision.draft.context).toBe(
      "Not reported met:\n- The name persists\n\nOr answer in your own words: your answer guides one more round.",
    );
  });

  it("asks before Publish, offering to call it met and publish", () => {
    const publish: Stage = {
      kind: "script",
      key: "publish",
      name: "Publish",
      optional: false,
      command: "publish",
    };
    const decision = walkDecision(aRun("implement", { status: "done", summary: "Done." }), {
      kind: "definition-of-done",
      unmet: ["It runs on Windows"],
      outOfReach: [{ statement: "It runs on Windows", why: "Only the workstation runs Windows." }],
      again: implement,
      before: publish,
    });

    expect(decision.draft).toMatchObject({
      question:
        "The Stages before Publish ended, but the Definition of Done isn't reported met. What now?",
      options: ['Run "Implement" once more', "Call it met and publish", "Drop the Task"],
      recommendation: {
        option: 1,
        reason:
          'Another round of "Implement" can\'t meet them: check those statements yourself first, then call it met.',
      },
    });
    expect(decision.options).toEqual([
      { kind: "one-more-round", guidance: undefined },
      { kind: "mark-done" },
      { kind: "drop" },
    ]);
  });

  it("lists what the Stage can address apart from what the user checks, still recommending one more round", () => {
    const decision = walkDecision(aRun("implement", { status: "done", summary: "Done." }), {
      kind: "definition-of-done",
      unmet: ["The name persists", "It runs on Windows"],
      outOfReach: [{ statement: "It runs on Windows", why: "Only the workstation runs Windows." }],
      again: implement,
      before: undefined,
    });

    expect(decision.draft.context).toBe(
      '"Implement" can address:\n- The name persists\n\n"Implement" can\'t verify these, so check them yourself:\n- It runs on Windows (Only the workstation runs Windows.)\n\nOr answer in your own words: your answer guides one more round.',
    );
    expect(decision.draft.recommendation.option).toBe(0);
    expect(decision.options[0]).toEqual({ kind: "one-more-round", guidance: undefined });
  });

  it("recommends marking the Task Done when the Stage can address none, the user checking them first", () => {
    const decision = walkDecision(aRun("implement", { status: "done", summary: "Done." }), {
      kind: "definition-of-done",
      unmet: ["It runs on Windows"],
      outOfReach: [{ statement: "It runs on Windows", why: "Only the workstation runs Windows." }],
      again: implement,
      before: undefined,
    });

    expect(decision.draft).toMatchObject({
      options: ['Run "Implement" once more', "Mark the Task Done", "Drop the Task"],
      recommendation: {
        option: 1,
        reason:
          'Another round of "Implement" can\'t meet them: check those statements yourself first, then mark it done.',
      },
    });
    expect(decision.draft.context).toContain(
      '"Implement" can\'t verify these, so check them yourself:\n- It runs on Windows (Only the workstation runs Windows.)',
    );
    expect(decision.draft.context).not.toContain("can address");
    expect(decision.options[1]).toEqual({ kind: "mark-done" });
  });

  it("asks whether to run again a Stage The Office restarted during three times in a row, saying so, or drop the Task", () => {
    const error =
      "The Office restarted during this Stage, which cut it short. Its uncommitted edits stay in the worktree, and the Stage goes on with them by itself.";
    const restarted = aRun("implement", { status: "failed", error, interrupted: "restart" });

    const decision = walkDecision(restarted, { kind: "restart", stage: implement });

    expect(decision).toMatchObject({
      kind: "restart",
      draft: {
        question: 'The Office restarted three times in a row during "Implement". Run it again?',
        options: ['Run "Implement" again', "Drop the Task"],
        recommendation: { option: 0 },
      },
      options: [{ kind: "one-more-round", guidance: undefined }, { kind: "drop" }],
    });
    expect(decision.draft.context).toContain(error);
    expect(decision.draft.context).toContain(
      "The Office goes on by itself after a restart, but not after three times in a row during one Stage",
    );
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

  it("takes the user's own words as guidance for one more round", () => {
    expect(walkAnswerOf(noRetries, { kind: "free-answer", text: " Mock the clock. " })).toEqual({
      kind: "one-more-round",
      guidance: "Mock the clock.",
    });
  });

  it("keeps whose words the guidance is when a Consultant answered in the user's place", () => {
    expect(
      walkAnswerOf(noRetries, { kind: "free-answer", text: "Mock the clock.", answeredBy: "cto" }),
    ).toEqual({ kind: "one-more-round", guidance: "Mock the clock.", guidedBy: "cto" });
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

describe("the branch-moved Decision", () => {
  const error = "The Task's worktree isn't where The Office left it: HEAD moved.";
  const run = aRun("implement", { status: "failed", error, branchMoved: true });
  const question = { kind: "branch-moved", stage: implement, error } as const;

  it("is the user's, not a Consultant's", () => {
    expect(asksAConsultantFirst(question, [run])).toBe(false);
  });

  it("keeps the branch on words of the user's own, guided by them", () => {
    const decision: StageRunDecision = {
      id: "decision-1",
      ...walkDecision(run, question),
      answer: undefined,
    };

    expect(walkAnswerOf(decision, { kind: "free-answer", text: " try again " })).toEqual({
      kind: "keep-branch",
      guidance: "try again",
    });
  });
});

describe("the base-moved Decision", () => {
  it("asks the user, after Resolve gave up, to resolve it in the worktree or drop the Task", () => {
    const resolve: Stage = {
      kind: "agent",
      key: RESOLVE_KEY,
      name: "Resolve",
      optional: false,
      role: "developer",
      brief: "",
      session: "fresh",
      budget: 500_000,
    };
    const error = "These files still hold conflict markers:\n- src/index.ts";
    const run = aRun(RESOLVE_KEY, { status: "failed", error });

    const decision = walkDecision(run, { kind: "base-moved", stage: resolve, error });

    expect(decision.draft.question).toBe(
      "\"Resolve\" couldn't resolve the Task's conflict with the base branch. What now?",
    );
    expect(decision.draft.context).toContain(error);
    expect(decision.draft.options).toEqual(["I resolved it in the worktree", "Drop the Task"]);
    expect(decision.options).toEqual([{ kind: "resolved-in-worktree" }, { kind: "drop" }]);
    expect(asksAConsultantFirst({ kind: "base-moved", stage: resolve, error }, [run])).toBe(false);
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

describe("asksAConsultantFirst", () => {
  const noRetriesLeft = {
    kind: "no-retries-left",
    stage: tests,
    error: "2 tests fail.",
    atLimit: usedUpRouteBack,
    others: [],
  } as const;

  it("asks the user once a Consultant sent that Stage back in this walk", () => {
    const runs = [aRun("tests", failed, [sentBack("cto")]), aRun("tests", failed)];

    expect(asksAConsultantFirst(noRetriesLeft, runs)).toBe(false);
  });

  it("asks a Consultant again after a round the user gave", () => {
    const runs = [aRun("tests", failed, [sentBack()]), aRun("tests", failed)];

    expect(asksAConsultantFirst(noRetriesLeft, runs)).toBe(true);
  });

  it("leaves budget limits and the Definition of Done to the user", () => {
    const run = aRun("implement", failed);

    expect(
      asksAConsultantFirst(
        { kind: "budget", stage: implement, reached: { used: 120_000, budget: 100_000 } },
        [run],
      ),
    ).toBe(false);
    expect(
      asksAConsultantFirst(
        {
          kind: "definition-of-done",
          unmet: ["It exports."],
          outOfReach: [],
          again: implement,
          before: undefined,
        },
        [run],
      ),
    ).toBe(false);
  });
});
