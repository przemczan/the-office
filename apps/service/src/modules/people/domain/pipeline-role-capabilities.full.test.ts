import { describe, expect, it } from "vitest";
import type { EngineCapability } from "../../engine/index.js";
import type { ProjectCascadeLevels } from "./engine-cascade.js";
import {
  incapableEngineProblems,
  newlyOnIncapableEngines,
  rolesOnIncapableEngines,
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
  it("finds the Roles the cascade puts on an engine lacking what Agent Stages need", () => {
    const project = aProject({ projectDefault: local });

    expect(
      rolesOnIncapableEngines(
        ["developer", "reviewer"],
        officeDefault,
        project,
        missingCapabilities,
      ),
    ).toEqual([
      { roleKey: "developer", engineId: "local", missing: ["outputSchema"] },
      { roleKey: "reviewer", engineId: "local", missing: ["outputSchema"] },
    ]);
  });

  it("weighs a Project's Role override over its default", () => {
    const project = aProject({
      projectDefault: local,
      roleOverrides: [{ roleKey: "reviewer", ...officeDefault }],
    });

    expect(
      rolesOnIncapableEngines(
        ["developer", "reviewer"],
        officeDefault,
        project,
        missingCapabilities,
      ),
    ).toEqual([{ roleKey: "developer", engineId: "local", missing: ["outputSchema"] }]);
  });

  it("weighs a forced Project default as a model only, never an engine", () => {
    const project = aProject({
      projectDefault: local,
      useForEveryRole: true,
      roleOverrides: [{ roleKey: "reviewer", ...officeDefault }],
    });

    expect(
      rolesOnIncapableEngines(["reviewer"], officeDefault, project, missingCapabilities),
    ).toEqual([]);
  });

  it("weighs the Office default alone outside any Project", () => {
    expect(rolesOnIncapableEngines(["developer"], local, undefined, missingCapabilities)).toEqual([
      { roleKey: "developer", engineId: "local", missing: ["outputSchema"] },
    ]);
    expect(
      rolesOnIncapableEngines(["developer"], officeDefault, undefined, missingCapabilities),
    ).toEqual([]);
  });

  it("weighs a Task's engine over the Project's default", () => {
    const project = aProject({ projectDefault: officeDefault });

    expect(
      rolesOnIncapableEngines(["developer"], officeDefault, project, missingCapabilities, {
        taskEngine: local,
        initiativeEngine: null,
      }),
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

  it("names the engine, what it lacks, the Roles on it once each and the Project", () => {
    const problems = incapableEngineProblems(
      [
        { roleKey: "developer", engineId: "local", missing: ["officeTools"] },
        { roleKey: "reviewer", engineId: "local", missing: ["officeTools"] },
        { roleKey: "developer", engineId: "local", missing: ["officeTools"] },
      ],
      { ...names, projectName: "Admin panel" },
    );

    expect(problems).toEqual([
      "Local models can't use Office tools, which the Agent Stages of the Developer and the Reviewer need in Admin panel.",
    ]);
  });

  it("says outside any Project when there is none, and a schema it can't hold its answer to", () => {
    const problems = incapableEngineProblems(
      [{ roleKey: "developer", engineId: "local", missing: ["outputSchema"] }],
      { ...names, projectName: undefined },
    );

    expect(problems).toEqual([
      "Local models can't hold its answer to the Stage result's schema, which the Agent Stages of the Developer need outside any Project.",
    ]);
  });

  it("names both when the engine lacks both", () => {
    const problems = incapableEngineProblems(
      [{ roleKey: "reviewer", engineId: "local", missing: ["officeTools", "outputSchema"] }],
      { ...names, projectName: "Admin panel" },
    );

    expect(problems).toEqual([
      "Local models can't use Office tools or hold its answer to the Stage result's schema, which the Agent Stages of the Reviewer need in Admin panel.",
    ]);
  });

  it("says it on a Task", () => {
    const problems = incapableEngineProblems(
      [{ roleKey: "developer", engineId: "local", missing: ["officeTools"] }],
      { ...names, projectName: "Admin panel", place: "On “Fix the login”" },
    );

    expect(problems).toEqual([
      "On “Fix the login”, Local models can't use Office tools, which the Agent Stages of the Developer need.",
    ]);
  });

  it("says it in an Initiative, on the Tasks it was found on", () => {
    const problems = incapableEngineProblems(
      [
        {
          roleKey: "developer",
          engineId: "local",
          missing: ["officeTools"],
          taskTitle: "Fix the login",
        },
        {
          roleKey: "developer",
          engineId: "local",
          missing: ["officeTools"],
          taskTitle: "Add a refund",
        },
      ],
      { ...names, projectName: undefined, place: "In Payments" },
    );

    expect(problems).toEqual([
      "In Payments, Local models can't use Office tools, which the Agent Stages of the Developer need on “Fix the login” and “Add a refund”.",
    ]);
  });
});
