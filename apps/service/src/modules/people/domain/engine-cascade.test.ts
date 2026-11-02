import { describe, expect, it } from "vitest";
import { engineInCascade, type ProjectCascadeLevels } from "./engine-cascade.js";

const officeDefault = { engineId: "claude-code", model: "claude-sonnet-5-5" };
const roleOverride = { engineId: "claude-code", model: "claude-opus-5-5" };
const projectDefault = { engineId: "second-account", model: "claude-haiku-5-5" };
const projectRoleOverride = { engineId: "local", model: "qwen3-coder" };

function aProject(levels: Partial<ProjectCascadeLevels> = {}): ProjectCascadeLevels {
  return { projectDefault: null, useForEveryRole: false, roleOverrides: [], ...levels };
}

describe("the engine cascade", () => {
  it("runs on the Office default when no other level is set", () => {
    expect(engineInCascade("developer", { officeDefault, roleOverride: null })).toEqual({
      ...officeDefault,
      level: "office-default",
    });
    expect(
      engineInCascade("developer", { officeDefault, roleOverride: null, project: aProject() }),
    ).toEqual({ ...officeDefault, level: "office-default" });
  });

  it("takes the Project default over the Office default", () => {
    const project = aProject({ projectDefault });
    expect(engineInCascade("developer", { officeDefault, roleOverride: null, project })).toEqual({
      ...projectDefault,
      level: "project-default",
    });
  });

  it("takes the Role override over the Project default", () => {
    const project = aProject({ projectDefault });
    expect(engineInCascade("developer", { officeDefault, roleOverride, project })).toEqual({
      ...roleOverride,
      level: "role-override",
    });
  });

  it("takes the Role override in no Project", () => {
    expect(engineInCascade("developer", { officeDefault, roleOverride })).toEqual({
      ...roleOverride,
      level: "role-override",
    });
  });

  it("takes the Project's Role override over every other level, its own Role's only", () => {
    const project = aProject({
      projectDefault,
      useForEveryRole: true,
      roleOverrides: [{ roleKey: "developer", ...projectRoleOverride }],
    });
    expect(engineInCascade("developer", { officeDefault, roleOverride, project })).toEqual({
      ...projectRoleOverride,
      level: "project-role-override",
    });
    expect(engineInCascade("reviewer", { officeDefault, roleOverride: null, project })).toEqual({
      ...projectDefault,
      level: "project-default",
    });
  });

  it("skips the Role override when the Project uses its default for every Role", () => {
    const project = aProject({ projectDefault, useForEveryRole: true });
    expect(engineInCascade("developer", { officeDefault, roleOverride, project })).toEqual({
      ...projectDefault,
      level: "project-default",
    });
  });
});
