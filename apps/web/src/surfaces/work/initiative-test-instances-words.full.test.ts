import type {
  InitiativeTestInstancesProject,
  TestInstance,
  TestInstanceState,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  instanceLine,
  logLinesOf,
  testInstancesStartOpen,
  testInstancesSummary,
} from "./initiative-test-instances-words.ts";

const LAUNCHED_AT = "2026-11-20T14:02:00.000Z";

function anInstance(state: TestInstanceState, commit: string | null = null): TestInstance {
  return {
    id: `${state}-${commit ?? "none"}`,
    initiativeId: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
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

function projectWith(...instances: TestInstance[]): InitiativeTestInstancesProject {
  return {
    projectId: "website",
    runEnvironmentOn: true,
    branchCommit: null,
    targets: [
      {
        key: "office",
        name: "Office",
        kind: "hosted",
        entryPoint: { kind: "devcontainer-service", service: "web" },
        instances,
      },
    ],
  };
}

describe("the Test instances fold's line", () => {
  it("counts the running and the building, each only when not 0", () => {
    const project = projectWith(
      anInstance("running"),
      anInstance("building"),
      anInstance("stopped"),
    );
    expect(testInstancesSummary([project])).toBe("1 running · 1 building");
  });

  it("says none runs once every instance has ended, and none launched before any", () => {
    expect(testInstancesSummary([projectWith(anInstance("failed"))])).toBe("None running");
    expect(testInstancesSummary([projectWith()])).toBe("None launched yet");
  });

  it("starts open only while one is Building or Running", () => {
    expect(testInstancesStartOpen([projectWith(anInstance("building"))])).toBe(true);
    expect(testInstancesStartOpen([projectWith(anInstance("stopped"))])).toBe(false);
    expect(testInstancesStartOpen(undefined)).toBe(false);
  });
});

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
