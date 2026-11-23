import type { StageProblem } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { byLevel, checkAwaited } from "./stages-check.ts";

describe("checkAwaited", () => {
  it("waits for the first check", () => {
    expect(checkAwaited({ isPending: true, isPlaceholderData: false })).toBe(true);
  });

  it("waits while the last answer is of Stages since changed", () => {
    expect(checkAwaited({ isPending: false, isPlaceholderData: true })).toBe(true);
  });

  it("doesn't wait on a refetch of the Stages on show, as another Task's event makes", () => {
    const refetching = { isPending: false, isPlaceholderData: false, isFetching: true };

    expect(checkAwaited(refetching)).toBe(false);
  });
});

describe("byLevel", () => {
  it("parts what holds Save from what it saves anyway", () => {
    const problem = { stageKey: "build", at: null, level: "problem", text: "No Role." } as const;
    const warning = { stageKey: null, at: null, level: "warning", text: "Nobody." } as const;

    expect(byLevel([warning, problem])).toEqual({ problems: [problem], warnings: [warning] });
  });

  it("keeps a problem both the editor and the service found once", () => {
    const fromEditor: StageProblem = {
      stageKey: "review",
      at: { kind: "route", routeIndex: 1, testPath: [0] },
      level: "problem",
      text: "Stage 2 · Review: a condition of its route to End is a choice with no words; say when the Agent chooses it.",
    };
    const fromService: StageProblem = {
      ...fromEditor,
      at: { testPath: [0], routeIndex: 1, kind: "route" },
    };

    expect(byLevel([fromEditor, fromService]).problems).toEqual([fromEditor]);
  });
});
