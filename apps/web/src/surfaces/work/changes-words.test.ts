import type { Stage, StageRun, TaskStage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { diffLines, editorLink, fileLineWords, latestTestResults } from "./changes-words.ts";

describe("diffLines", () => {
  it("tells the file header, hunks, added, removed and unchanged lines apart", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
      "--- a removed line that starts with dashes",
      "+++ an added line that starts with pluses",
      "diff --git a/b.md b/b.md",
      "--- a/b.md",
      "",
    ].join("\n");

    expect(diffLines(diff).map(({ kind }) => kind)).toEqual([
      "file",
      "file",
      "file",
      "file",
      "hunk",
      "context",
      "removed",
      "added",
      "removed",
      "added",
      "file",
      "file",
    ]);
  });

  it("has no lines for no diff", () => {
    expect(diffLines("")).toEqual([]);
  });
});

describe("fileLineWords", () => {
  it("counts a text file's lines and calls a binary file binary", () => {
    expect(
      fileLineWords({
        path: "a.ts",
        previousPath: null,
        lines: { added: 14, removed: 6 },
        deleted: false,
      }),
    ).toEqual({ added: "+14", removed: "−6" });
    expect(
      fileLineWords({ path: "logo.png", previousPath: null, lines: null, deleted: false }),
    ).toBe("binary");
  });
});

function aRun(number: number, outcome: StageRun["outcome"]): StageRun {
  return {
    id: "8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e9f",
    number,
    startedAt: "2026-10-26T10:00:00.000Z",
    endedAt: outcome ? "2026-10-26T10:02:00.000Z" : null,
    threadId: null,
    session: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    carriedFailure: null,
    sentBack: null,
    gateAction: null,
    commandRuns: [],
    outcome,
  };
}

function aTaskStage(stage: Stage, runs: StageRun[] = []): TaskStage {
  return { stage, state: "pending", tokens: 0, wentBack: null, runs };
}

const failed = (error: string, interrupted: "stop" | "pause" | "restart" | null = null) =>
  ({ status: "failed", error, budgetReached: null, interrupted, handoverNote: null }) as const;

describe("latestTestResults", () => {
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
  };
  const lint: Stage = {
    kind: "script",
    key: "lint",
    name: "Lint",
    optional: true,
    command: "lint",
  };
  const publish: Stage = {
    kind: "script",
    key: "publish",
    name: "Publish",
    optional: false,
    command: "publish",
  };

  it("gives each checking Script Stage its latest result, leaving out Agent Stages and Publish", () => {
    const results = latestTestResults([
      aTaskStage(implement, [aRun(1, null)]),
      aTaskStage(tests, [
        aRun(2, failed("`npm test` failed with exit code 1\nmore output")),
        aRun(4, {
          status: "done",
          summary: "`npm test` passed",
          skipped: false,
          handoverNote: null,
        }),
      ]),
      aTaskStage(lint, [
        aRun(5, { status: "done", summary: "", skipped: true, handoverNote: null }),
      ]),
      aTaskStage(publish),
    ]);

    expect(results).toEqual([
      { stageKey: "tests", name: "Tests", state: "passed", detail: "npm test passed" },
      { stageKey: "lint", name: "Lint", state: "skipped", detail: undefined },
    ]);
  });

  it("keeps the last result a run ended by itself, past runs the user held or The Office restarted", () => {
    const results = latestTestResults([
      aTaskStage(tests, [
        aRun(2, failed("`npm test` failed with exit code 1")),
        aRun(3, failed("Stopped by the user.", "stop")),
        aRun(4, null),
      ]),
      aTaskStage(lint, [aRun(5, failed("The Office restarted.", "restart"))]),
    ]);

    expect(results).toEqual([
      {
        stageKey: "tests",
        name: "Tests",
        state: "failed",
        detail: "npm test failed with exit code 1",
      },
      { stageKey: "lint", name: "Lint", state: "not-run", detail: undefined },
    ]);
  });
});

describe("editorLink", () => {
  it("opens a Windows worktree with forward slashes and its drive letter", () => {
    expect(editorLink("C:\\Users\\ada\\office-data\\worktrees\\admin\\task-1")).toBe(
      "vscode://file/C:/Users/ada/office-data/worktrees/admin/task-1",
    );
  });

  it("opens a file of a Linux worktree", () => {
    expect(editorLink("/home/ada/.office/worktrees/admin/task-1/", "src/ble/link.ts")).toBe(
      "vscode://file/home/ada/.office/worktrees/admin/task-1/src/ble/link.ts",
    );
  });

  it("escapes what a URL can't hold in a path", () => {
    expect(editorLink("D:\\My Projects\\wt", "notes #1?.md")).toBe(
      "vscode://file/D:/My%20Projects/wt/notes%20%231%3F.md",
    );
  });
});
