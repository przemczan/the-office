import { describe, expect, it } from "vitest";
import {
  engineInCascade,
  movedProjectLevels,
  roleEngineCascade,
  NO_WORK_LEVELS,
  type ProjectCascadeLevels,
} from "./engine-cascade.js";

const officeDefault = { engineId: "claude-code", model: "claude-sonnet-5-5" };
const roleOverride = { engineId: "claude-code", model: "claude-opus-5-5" };
const projectDefault = { engineId: "second-account", model: "claude-haiku-5-5" };
const projectRoleOverride = { engineId: "local", model: "qwen3-coder" };
const taskEngine = { engineId: "codex", model: "gpt-6" };
const initiativeEngine = { engineId: "gemini", model: "gemini-4-pro" };

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

  it("gives none when no level is set, as while no engine is listed", () => {
    expect(
      engineInCascade("developer", {
        officeDefault: null,
        roleOverride: null,
        project: aProject(),
      }),
    ).toBeNull();
    expect(
      roleEngineCascade("developer", { officeDefault: null, roleOverride: null }, [
        { projectId: "p1", projectName: "Shop", ...aProject() },
      ]),
    ).toEqual({ outsideProjects: null, elsewhereInProjects: [] });
  });
});

describe("movedProjectLevels", () => {
  it("drops levels moved to none, and the force with the Project default", () => {
    const project = aProject({
      projectDefault,
      useForEveryRole: true,
      roleOverrides: [
        { roleKey: "developer", ...projectRoleOverride },
        { roleKey: "reviewer", ...roleOverride },
      ],
    });
    const moved = movedProjectLevels(project, (reference) =>
      reference.engineId === "claude-code" ? reference : null,
    );

    expect(moved).toEqual({
      projectDefault: null,
      useForEveryRole: false,
      roleOverrides: [{ roleKey: "reviewer", ...roleOverride }],
    });
  });
});

describe("the engine cascade on a Task or an Initiative", () => {
  it("takes the Task's engine over the Initiative's, the Project default and the Office default", () => {
    const project = aProject({ projectDefault });
    expect(
      engineInCascade("developer", {
        officeDefault,
        roleOverride: null,
        project,
        work: { taskEngine, initiativeEngine },
      }),
    ).toEqual({ ...taskEngine, level: "task-engine" });
  });

  it("takes the Initiative's engine while the Task sets none", () => {
    const project = aProject({ projectDefault });
    expect(
      engineInCascade("developer", {
        officeDefault,
        roleOverride: null,
        project,
        work: { taskEngine: null, initiativeEngine },
      }),
    ).toEqual({ ...initiativeEngine, level: "initiative-engine" });
  });

  it("takes the Initiative's engine in no Project too", () => {
    expect(
      engineInCascade("developer", {
        officeDefault,
        roleOverride: null,
        work: { taskEngine: null, initiativeEngine },
      }),
    ).toEqual({ ...initiativeEngine, level: "initiative-engine" });
  });

  it("falls back to the Project default, then the Office default, with neither set", () => {
    expect(
      engineInCascade("developer", {
        officeDefault,
        roleOverride: null,
        project: aProject({ projectDefault }),
        work: NO_WORK_LEVELS,
      }),
    ).toEqual({ ...projectDefault, level: "project-default" });
    expect(
      engineInCascade("developer", { officeDefault, roleOverride: null, work: NO_WORK_LEVELS }),
    ).toEqual({ ...officeDefault, level: "office-default" });
  });

  it("lets both Role overrides win over the Task's engine", () => {
    const work = { taskEngine, initiativeEngine };
    expect(
      engineInCascade("developer", { officeDefault, roleOverride, project: aProject(), work }),
    ).toEqual({ ...roleOverride, level: "role-override" });
    const project = aProject({
      roleOverrides: [{ roleKey: "developer", ...projectRoleOverride }],
    });
    expect(engineInCascade("developer", { officeDefault, roleOverride, project, work })).toEqual({
      ...projectRoleOverride,
      level: "project-role-override",
    });
  });

  it("takes the Task's and the Initiative's engine over the Role override under Use for every Role", () => {
    const project = aProject({ projectDefault, useForEveryRole: true });
    expect(
      engineInCascade("developer", {
        officeDefault,
        roleOverride,
        project,
        work: { taskEngine, initiativeEngine },
      }),
    ).toEqual({ ...taskEngine, level: "task-engine" });
    expect(
      engineInCascade("developer", {
        officeDefault,
        roleOverride,
        project,
        work: { taskEngine: null, initiativeEngine },
      }),
    ).toEqual({ ...initiativeEngine, level: "initiative-engine" });
  });

  it("keeps the Project's Role override first under Use for every Role", () => {
    const project = aProject({
      projectDefault,
      useForEveryRole: true,
      roleOverrides: [{ roleKey: "developer", ...projectRoleOverride }],
    });
    expect(
      engineInCascade("developer", {
        officeDefault,
        roleOverride,
        project,
        work: { taskEngine, initiativeEngine: null },
      }),
    ).toEqual({ ...projectRoleOverride, level: "project-role-override" });
  });

  it("lets the Office-wide Role override win in a Project with no default", () => {
    expect(
      engineInCascade("developer", {
        officeDefault,
        roleOverride,
        project: aProject(),
        work: { taskEngine, initiativeEngine },
      }),
    ).toEqual({ ...roleOverride, level: "role-override" });
  });
});
