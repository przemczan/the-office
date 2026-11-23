import type { Stage } from "./stage.js";
import type { StageRun } from "./stage-run.js";

/** How a checking Script Stage last ended by itself: a held or restarted run tells nothing of the code. */
export type TestResultState = "passed" | "failed" | "skipped" | "not-run";

/** The latest result of a Script Stage that checks the code, as Changes and a pull request show it. */
export interface TestResult {
  readonly stageKey: string;
  readonly name: string;
  readonly state: TestResultState;
  /** The first line of its summary or error, in The Office's Markdown; undefined before it ran. */
  readonly detail: string | undefined;
}

/**
 * The latest result of each Script Stage, as each checks the code (build, lint, tests), in the
 * Stages' order; a Publish Stage ships the code rather than checking it.
 */
export function latestTestResults(
  stages: readonly Stage[],
  runs: readonly StageRun[],
): TestResult[] {
  return stages.flatMap((stage): TestResult[] => {
    if (stage.kind !== "script") return [];
    const outcome = runs.findLast(
      ({ stageKey, outcome: ended }) =>
        stageKey === stage.key &&
        (ended?.status === "done" || (ended?.status === "failed" && !ended.interrupted)),
    )?.outcome;
    const base = { stageKey: stage.key, name: stage.name };
    switch (outcome?.status) {
      case "done":
        return [
          outcome.skipped
            ? { ...base, state: "skipped", detail: undefined }
            : { ...base, state: "passed", detail: firstLine(outcome.summary) },
        ];
      case "failed":
        return [{ ...base, state: "failed", detail: firstLine(outcome.error) }];
      default:
        return [{ ...base, state: "not-run", detail: undefined }];
    }
  });
}

function firstLine(text: string): string {
  return text.trim().split("\n", 1)[0]?.trim() ?? "";
}
