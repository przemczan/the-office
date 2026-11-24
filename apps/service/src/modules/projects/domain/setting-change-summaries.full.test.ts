import { describe, expect, it } from "vitest";
import type { Action } from "./action.js";
import type { ProjectEnvironment } from "./project-environment.js";
import {
  actionsSummary,
  environmentSummary,
  runEnvironmentSummary,
  testTargetsSummary,
} from "./setting-change-summaries.js";
import type { TestTarget } from "./test-target.js";

const NONE: ProjectEnvironment = { set: [], unset: [], prependPath: [] };

describe("environmentSummary", () => {
  it("names the variables set and removed, never a value, secret or not", () => {
    const before: ProjectEnvironment = {
      ...NONE,
      set: [
        { name: "KEEP", value: "same", secret: false },
        { name: "GONE", value: "old", secret: false },
        { name: "TOKEN", value: "old-secret-value", secret: true },
      ],
    };
    const after: ProjectEnvironment = {
      ...NONE,
      set: [
        { name: "KEEP", value: "same", secret: false },
        { name: "TOKEN", value: "new-secret-value", secret: true },
        { name: "GREETING", value: "hello", secret: false },
      ],
    };

    const summary = environmentSummary(before, after);

    expect(summary).toBe(
      "set the Environment variables TOKEN, GREETING and removed the Environment variable GONE",
    );
    expect(summary).not.toMatch(/secret-value|hello|same|old/);
  });

  it("names the lists of variables to remove and of folders in front of PATH as the page does", () => {
    expect(environmentSummary(NONE, { ...NONE, unset: ["CI"] })).toBe(
      "changed Variables to remove",
    );
    expect(environmentSummary(NONE, { ...NONE, prependPath: ["/opt/bin"] })).toBe(
      "changed Folders in front of PATH",
    );
  });
});

describe("runEnvironmentSummary", () => {
  it("says which way the switch was turned", () => {
    expect(runEnvironmentSummary("on")).toBe("turned Run environment On");
    expect(runEnvironmentSummary("off")).toBe("turned Run environment Off");
  });
});

describe("testTargetsSummary and actionsSummary", () => {
  const web = { key: "web", name: "Web", port: 3000 } as unknown as TestTarget;
  const api = { key: "api", name: "API", port: 4000 } as unknown as TestTarget;

  it("names the one target added or removed, and says Test targets for more", () => {
    expect(testTargetsSummary([], [web])).toBe("added the Test target Web");
    expect(testTargetsSummary([api], [])).toBe("removed the Test target API");
    expect(testTargetsSummary([web], [api])).toBe("changed Test targets");
  });

  it("names the one Action added, changed or removed", () => {
    const build = {
      key: "build",
      name: "Build",
      kind: "project-command",
      settings: { commandKey: "build", commandsBefore: [], timeLimitMinutes: null },
      leavesTheWorkstation: false,
      setBy: {},
    } as Action;
    const renamed = { ...build, name: "Build it" } as Action;

    expect(actionsSummary([], [build])).toBe("added the Action Build");
    expect(actionsSummary([build], [renamed])).toBe("changed the Action Build it");
    expect(actionsSummary([build], [])).toBe("removed the Action Build");
  });
});
