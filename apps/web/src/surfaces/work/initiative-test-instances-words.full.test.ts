import type {
  InitiativeTestInstancesProject,
  TestInstance,
  TestInstanceState,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { testInstancesStartOpen, testInstancesSummary } from "./initiative-test-instances-words.ts";

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
    runAs: null,
    device: null,
    buildInstanceId: null,
    builtFor: null,
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
        installs: null,
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
