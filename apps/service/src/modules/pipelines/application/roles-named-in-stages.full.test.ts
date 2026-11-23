import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PipelineRoleSources } from "../../people/index.js";
import { agentStage } from "../domain/stage.fixtures.js";
import {
  startPipelinesApplication,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { PipelineLibrary } from "./pipeline-library.js";
import { PipelineLibraryEditor } from "./pipeline-library-editor.js";

let pipelines: PipelinesApplication;

beforeEach(async () => {
  pipelines = await startPipelinesApplication();
});

afterEach(async () => {
  await pipelines.app.close();
});

/** A Task in its own Project, with own Stages naming the Role, in the state given. */
async function aTaskNaming(
  roleKey: string,
  state: string,
  taskId: string = randomUUID(),
): Promise<string> {
  const projectId = randomUUID();
  await pipelines.app.get(TaskStagesRepository, { strict: false }).save({
    taskId,
    pipelineId: "quick-fix",
    stages: [agentStage({ role: roleKey })],
    madeAt: new Date(),
    editedForTask: true,
    trace: undefined,
  });
  pipelines.tasks.put(taskId, { state, pipelineId: "quick-fix", projectId });
  return projectId;
}

describe("RolesNamedInStages", () => {
  it("tells People the library's Roles everywhere and each open Task's in its Project", async () => {
    const open = await aTaskNaming("designer", "in-progress");
    const dropped = await aTaskNaming("tester", "dropped");

    const named = await pipelines.app.get(PipelineRoleSources, { strict: false }).rolesNamed();

    const library = await pipelines.app.get(PipelineLibrary).rolesNamed();
    expect(named.everywhere).toEqual(library.roles);
    // The built-ins name duties, which People weighs by their holders.
    expect(named.duties?.everywhere).toEqual(library.duties);
    expect(library.duties.has("implements")).toBe(true);
    expect(named.byProject.get(open)).toEqual(new Set(["designer"]));
    expect(named.byProject.has(dropped)).toBe(false);
  });

  it("leaves a Task under an engine override out of its Project's, as it is weighed at its override alone", async () => {
    const ownOverride = randomUUID();
    const initiativeOverride = randomUUID();
    const onProject = await aTaskNaming("designer", "in-progress");
    const forced = await aTaskNaming("tester", "in-progress", ownOverride);
    const forcedByInitiative = await aTaskNaming("tester", "in-progress", initiativeOverride);
    const none = { from: "none", engineIds: [] } as const;
    pipelines.cascade.setEngineFor(ownOverride, {
      engineId: "codex",
      engineType: "codex",
      level: "task",
      standIns: none,
    });
    pipelines.cascade.setEngineFor(initiativeOverride, {
      engineId: "codex",
      engineType: "codex",
      level: "initiative",
      standIns: none,
    });

    const named = await pipelines.app.get(PipelineRoleSources, { strict: false }).rolesNamed();

    expect(named.byProject.get(onProject)).toEqual(new Set(["designer"]));
    expect(named.byProject.has(forced)).toBe(false);
    expect(named.byProject.has(forcedByInitiative)).toBe(false);
  });
});

describe("RolesNamedInStages, for one Task", () => {
  it("tells People whom the Stages a Task works name, and nothing for a Task it doesn't know", async () => {
    const taskId = randomUUID();
    await aTaskNaming("designer", "in-progress", taskId);
    const sources = pipelines.app.get(PipelineRoleSources, { strict: false });

    await expect(sources.rolesNamedByTask(taskId)).resolves.toEqual({
      roleKeys: ["designer"],
      dutyKeys: [],
    });
    await expect(sources.rolesNamedByTask(randomUUID())).resolves.toEqual({
      roleKeys: [],
      dutyKeys: [],
    });
  });
});

describe("RolesNamedInStages, with Project Pipelines", () => {
  it("counts a Project Pipeline's built Stages' Roles in its Project only", async () => {
    const editor = pipelines.app.get(PipelineLibraryEditor);
    const projectId = randomUUID();
    const roleKey = `designer-${randomUUID()}`;
    pipelines.projects.projects.push({
      id: projectId,
      name: "Site",
      defaultPipeline: "quick-fix",
      commands: [],
    });
    const base = await editor.add({
      name: `Base ${randomUUID()}`,
      description: "",
      stages: [agentStage()],
    });
    await editor.addProjectPipeline(projectId, {
      name: `Designed ${randomUUID()}`,
      description: "",
      basePipelineId: base.id,
      stageChanges: [{ kind: "change", stageKey: "implement", fields: { role: roleKey } }],
    });

    const named = await pipelines.app.get(PipelineRoleSources, { strict: false }).rolesNamed();

    expect(named.byProject.get(projectId)).toEqual(new Set([roleKey]));
    expect(named.everywhere.has(roleKey)).toBe(false);
  });
});
