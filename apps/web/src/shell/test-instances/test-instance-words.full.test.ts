import type { TestInstance, TestInstanceState } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { instanceLine, logLinesOf } from "./test-instance-words.ts";

const LAUNCHED_AT = "2026-11-20T14:02:00.000Z";

function anInstance(state: TestInstanceState, commit: string | null = null): TestInstance {
  return {
    id: `${state}-${commit ?? "none"}`,
    initiativeId: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
    branch: "initiative/checkout",
    projectId: "website",
    targetKey: "office",
    targetName: "Office",
    kind: "hosted",
    state,
    commit,
    port: null,
    failedReason: null,
    launchedBy: { kind: "user", user: null },
    launchedAt: LAUNCHED_AT,
    runningAt: null,
    endedAt: null,
    files: [],
    filesRemoved: false,
  };
}

describe("a row's line", () => {
  it("gives the short commit and the moment, or the moment alone before the checkout", () => {
    const now = new Date(LAUNCHED_AT);
    expect(instanceLine(anInstance("building", "a1b2c3d4e5f6"), now)).toMatch(
      /^a1b2c3d · \d\d:\d\d$/,
    );
    expect(instanceLine(anInstance("building"), now)).toMatch(/^\d\d:\d\d$/);
  });
});

describe("the log's lines", () => {
  it("marks The Office's own lines and the reason it failed", () => {
    expect(
      logLinesOf("[The Office] Fetching main.\nlistening\n[The Office] Failed: no answer.\n"),
    ).toEqual([
      { kind: "office", text: "Fetching main." },
      { kind: "output", text: "listening" },
      { kind: "failed", text: "Failed: no answer." },
    ]);
  });
});
