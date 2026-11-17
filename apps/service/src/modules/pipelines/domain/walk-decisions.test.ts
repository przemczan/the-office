import { describe, expect, it } from "vitest";
import type { Route } from "./route.js";
import type { Stage } from "./stage.js";
import { type StageRunDecision } from "./stage-run.js";
import { asksAConsultantFirst, walkAnswerOf, walkDecision } from "./walk-decisions.js";
import { implement, tests, aRun, failed } from "./walk-decisions.fixtures.js";

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

  const failedOnce: StageRunDecision = {
    id: "decision-2",
    kind: "no-retries-left",
    options: [
      { kind: "one-more-round", guidance: undefined },
      { kind: "accept-issues" },
      { kind: "drop" },
    ],
    answer: undefined,
  };

  it("guides one more round chosen with the comments given beside it, the user's", () => {
    // stageAnswerOf joins the option's comment and the general comment into the guidance.
    const guidance = "Mock the clock.\n\nAnd keep the test small.";

    expect(walkAnswerOf(failedOnce, { kind: "option", option: 0, guidance })).toEqual({
      kind: "one-more-round",
      guidance,
    });
  });

  it("names the Consultant whose comments guide the round", () => {
    expect(
      walkAnswerOf(failedOnce, {
        kind: "option",
        option: 0,
        guidance: "Mock the clock.",
        answeredBy: "cto",
      }),
    ).toEqual({ kind: "one-more-round", guidance: "Mock the clock.", guidedBy: "cto" });
  });

  it("names the Consultant whose own words guide the round", () => {
    expect(
      walkAnswerOf(failedOnce, { kind: "free-answer", text: "Mock the clock.", answeredBy: "cto" }),
    ).toEqual({ kind: "one-more-round", guidance: "Mock the clock.", guidedBy: "cto" });
  });

  it("leaves comments out of an option that takes no guidance", () => {
    expect(
      walkAnswerOf(failedOnce, { kind: "option", option: 1, guidance: "Fine by me." }),
    ).toEqual({ kind: "accept-issues" });
  });
});

describe("the branch-moved Decision", () => {
  const error = "The Task's worktree isn't where The Office left it: HEAD moved.";
  const run = aRun("implement", { status: "failed", error, branchMoved: true });
  const question = { kind: "branch-moved", stage: implement, error } as const;

  it("offers to keep the branch, to run the Stage after putting it back, or to drop the Task", () => {
    const decision = walkDecision(run, question);

    expect(decision.draft.options).toEqual([
      "Keep the branch as it is",
      'I put the branch back: run "Implement" again',
      "Drop the Task",
    ]);
    expect(decision.options).toEqual([
      { kind: "keep-branch", guidance: undefined },
      { kind: "one-more-round", guidance: undefined },
      { kind: "drop" },
    ]);
    expect(decision.draft.context).toContain(error);
  });

  it("keeps the branch guided by the comments given beside the option", () => {
    const decision = walkDecision(run, question);
    const kept: StageRunDecision = {
      id: "decision-3",
      kind: "branch-moved",
      options: decision.options,
      answer: undefined,
    };

    expect(walkAnswerOf(kept, { kind: "option", option: 0, guidance: "I rebased it." })).toEqual({
      kind: "keep-branch",
      guidance: "I rebased it.",
    });
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
        context: `${error}\n\nThe Task has no Agent Stage whose person could resolve the conflict, and no Agent can merge or rebase. "Publish" can run again once the base branch no longer conflicts with the branch.`,
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

describe("the no-route-holds Decision", () => {
  const routes = [
    {
      to: "review",
      toName: "Review",
      condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "failed" }] },
    },
    {
      to: null,
      condition: { combine: "all", tests: [{ kind: "definitionOfDone", is: "all-met" }] },
    },
  ] as const satisfies readonly Route[];
  const asked = (why?: string) =>
    walkDecision(aRun("tests", failed), { kind: "no-route-holds", stage: tests, routes, why });

  it("offers each route by where it leads, the first recommended, or dropping the Task", () => {
    const decision = asked();

    expect(decision).toMatchObject({
      kind: "no-route-holds",
      draft: {
        question: 'None of the routes out of "Tests" holds. Where does the walk go on?',
        options: ["Go on to Review", "End the Pipeline here", "Drop the Task"],
        recommendation: { option: 0 },
      },
      options: [
        { kind: "follow-route", to: "review" },
        { kind: "follow-route", to: null },
        { kind: "drop" },
      ],
    });
    expect(decision.draft.context).toContain(
      '"Tests" goes to Review when the previous Stage ended Failed, otherwise to End when the Definition of Done is all Reported met.',
    );
  });

  it("says why when a route can't be weighed", () => {
    expect(asked("The command timed out.").draft.question).toBe(
      'The Office can\'t weigh a route out of "Tests": The command timed out. Where does the walk go on?',
    );
  });

  it("keeps the comments as notes, and follows the first route with words of the user's own", () => {
    const { kind, options } = asked();
    const decision: StageRunDecision = { id: "decision-1", kind, options, answer: undefined };

    expect(walkAnswerOf(decision, { kind: "option", option: 1, guidance: " Ship it. " })).toEqual({
      kind: "follow-route",
      to: null,
      guidance: "Ship it.",
    });
    expect(walkAnswerOf(decision, { kind: "free-answer", text: "Review the docs too." })).toEqual({
      kind: "follow-route",
      to: "review",
      guidance: "Review the docs too.",
    });
    expect(walkAnswerOf(decision, { kind: "option", option: 2 })).toEqual({ kind: "drop" });
  });

  it("is put to the user directly", () => {
    expect(
      asksAConsultantFirst({ kind: "no-route-holds", stage: tests, routes, why: undefined }, []),
    ).toBe(false);
  });
});

describe("asksAConsultantFirst", () => {
  const noRetriesLeft = { kind: "no-retries-left", stage: tests, error: "2 tests fail." } as const;

  it("puts a Stage failing with no retries left to a Consultant first", () => {
    expect(asksAConsultantFirst(noRetriesLeft, [aRun("tests", failed)])).toBe(true);
  });
});
