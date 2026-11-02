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

let pipelines: PipelinesApplication;

beforeEach(async () => {
  pipelines = await startPipelinesApplication();
});

afterEach(async () => {
  await pipelines.app.close();
});

/** A Task in its own Project, with own Stages naming the Role, in the state given. */
async function aTaskNaming(roleKey: string, state: string): Promise<string> {
  const taskId = randomUUID();
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

    expect(named.everywhere).toEqual(await pipelines.app.get(PipelineLibrary).rolesNamed());
    expect(named.byProject.get(open)).toEqual(new Set(["designer"]));
    expect(named.byProject.has(dropped)).toBe(false);
  });
});
