import { describe, expect, it } from "vitest";
import type { EngineCapability } from "../../engine/index.js";
import type { ProjectCascadeLevels } from "./engine-cascade.js";
import {
  incapableEngineProblems,
  newlyOnIncapableEngines,
  rolesOnIncapableEngines,
  type PipelineRole,
} from "./pipeline-role-capabilities.js";

const officeDefault = { engineId: "claude-code", model: "claude-sonnet-5-5" };
const local = { engineId: "local", model: "gpt-oss" };

/** "local" can't hold an answer to a schema or interrupt; every other engine can do everything. */
function missingCapabilities(engineId: string): readonly EngineCapability[] {
  return engineId === "local" ? ["interrupt", "outputSchema"] : [];
}

function aProject(levels: Partial<ProjectCascadeLevels> = {}): ProjectCascadeLevels {
  return { projectDefault: null, useForEveryRole: false, roleOverrides: [], ...levels };
}

describe("rolesOnIncapableEngines", () => {
  const developer: PipelineRole = { roleKey: "developer", roleOverride: null };
  const reviewer: PipelineRole = { roleKey: "reviewer", roleOverride: officeDefault };

  it("finds the Roles the cascade puts on an engine lacking what Agent Stages need", () => {
    const project = aProject({ projectDefault: local });

    expect(
      rolesOnIncapableEngines([developer, reviewer], officeDefault, project, missingCapabilities),
    ).toEqual([{ roleKey: "developer", engineId: "local", missing: ["outputSchema"] }]);
  });

  it("weighs a forced Project default over the Role overrides", () => {
    const project = aProject({ projectDefault: local, useForEveryRole: true });

    expect(
      rolesOnIncapableEngines([reviewer], officeDefault, project, missingCapabilities),
    ).toEqual([{ roleKey: "reviewer", engineId: "local", missing: ["outputSchema"] }]);
  });

  it("weighs the Office levels alone outside any Project", () => {
    const onLocal: PipelineRole = { roleKey: "developer", roleOverride: local };

    expect(
      rolesOnIncapableEngines([onLocal, reviewer], officeDefault, undefined, missingCapabilities),
    ).toEqual([{ roleKey: "developer", engineId: "local", missing: ["outputSchema"] }]);
  });
});

describe("newlyOnIncapableEngines", () => {
  it("keeps only the Roles that weren't on an incapable engine before", () => {
    const developer = {
      roleKey: "developer",
      engineId: "local",
      missing: ["outputSchema"] as const,
    };
    const reviewer = { roleKey: "reviewer", engineId: "local", missing: ["outputSchema"] as const };

    expect(newlyOnIncapableEngines([developer], [developer, reviewer])).toEqual([reviewer]);
  });
});

describe("incapableEngineProblems", () => {
  const names = {
    roleTitle: (roleKey: string) => (roleKey === "developer" ? "Developer" : "Reviewer"),
    engineName: (engineId: string) => (engineId === "local" ? "Local models" : engineId),
  };

  it("names the Roles on each engine, what it lacks and the Project", () => {
    const problems = incapableEngineProblems(
      [
        { roleKey: "developer", engineId: "local", missing: ["outputSchema"] },
        { roleKey: "reviewer", engineId: "local", missing: ["officeTools", "outputSchema"] },
      ],
      { ...names, projectName: "Admin panel" },
    );

    expect(problems).toEqual([
      "In Admin panel, the Developer and the Reviewer would run on Local models, which can't use Office tools or hold a Stage's answer to a schema, as their Pipelines' Agent Stages need.",
    ]);
  });

  it("says outside any Project when there is none", () => {
    const problems = incapableEngineProblems(
      [{ roleKey: "developer", engineId: "local", missing: ["outputSchema"] }],
      { ...names, projectName: undefined },
    );

    expect(problems).toEqual([
      "Outside any Project, the Developer would run on Local models, which can't hold a Stage's answer to a schema, as their Pipelines' Agent Stages need.",
    ]);
  });
});
