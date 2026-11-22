import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskEngineChecks, type TaskEngineMove } from "../../work/index.js";
import type { Stage } from "../domain/stage.js";
import {
  startPipelinesApplication,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aPerson } from "../ports/pipelines-ports.fixtures.js";
import { TaskRoleEngines } from "./task-role-engines.js";
import { TaskStagesService } from "./task-stages-service.js";
import { quickFix } from "./task-stages-service.fixtures.js";

let pipelines: PipelinesApplication;
let checks: TaskEngineChecks;

beforeEach(async () => {
  pipelines = await startPipelinesApplication();
  checks = pipelines.app.get(TaskEngineChecks, { strict: false });
});

afterEach(async () => {
  await pipelines.app.close();
});

const onLocal = { engineId: "local", model: "gpt-oss" };

function aMove(taskId: string): TaskEngineMove {
  return {
    taskId,
    projectId: "billing",
    before: { taskEngine: null, initiativeEngine: null },
    after: { taskEngine: onLocal, initiativeEngine: null },
  };
}

/** Quick fix with its first Stage worked by the translator, not the Implements duty. */
function translatedQuickFix(): Stage[] {
  const [implement, ...rest] = quickFix;
  if (implement?.kind !== "agent") throw new Error("Quick fix starts with an Agent Stage.");
  const { duty: _implements, ...namingNobody } = implement;
  return [{ ...namingNobody, role: "translator" }, ...rest];
}

describe("TaskRoleEngines as a check on a change of Tasks' engines", () => {
  it("weighs the Roles and duties the Task's own Stages name, in the change's place", async () => {
    pipelines.people.people.set("translator", aPerson());
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "ready", pipelineId: "quick-fix", projectId: "billing" });
    await pipelines.app.get(TaskStagesService).edit(taskId, translatedQuickFix());
    pipelines.roleEngines.incapableRoles.add("translator");

    expect(
      await checks.problemsOf({ place: "On “Fix the login”", moves: [aMove(taskId)] }),
    ).toEqual(["On “Fix the login”, the translator's engine can't work an Agent Stage."]);
    const { taskId: _taskId, ...move } = aMove(taskId);
    expect(pipelines.roleEngines.changesAsked.at(-1)).toEqual({
      place: "On “Fix the login”",
      tasks: [{ ...move, roleKeys: ["translator"], dutyKeys: [] }],
    });
  });

  it("weighs a Task following its Pipeline by the Pipeline's Stages", async () => {
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "ready", pipelineId: "quick-fix", projectId: "billing" });

    expect(await checks.problemsOf({ place: "In Payments", moves: [aMove(taskId)] })).toEqual([]);
    expect(pipelines.roleEngines.changesAsked.at(-1)?.tasks).toEqual([
      expect.objectContaining({ projectId: "billing", dutyKeys: ["implements"] }),
    ]);
  });

  it("weighs a chosen Pipeline's Stages against those the Task works now", async () => {
    pipelines.people.people.set("translator", aPerson());
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "ready", pipelineId: "quick-fix", projectId: "billing" });
    await pipelines.app.get(TaskStagesService).edit(taskId, translatedQuickFix());
    pipelines.roleEngines.incapableRoles.add("translator");
    const levels = { taskEngine: onLocal, initiativeEngine: null };
    const choosing = { taskId, projectId: "billing", before: levels, after: levels };

    // The chosen Pipeline's Stages name the Implements duty in place of the translator.
    expect(
      await checks.problemsOf({
        place: "On “Fix the login”",
        moves: [{ ...choosing, pipelineId: "document" }],
      }),
    ).toEqual([]);
    expect(pipelines.roleEngines.changesAsked.at(-1)?.tasks).toEqual([
      {
        projectId: "billing",
        roleKeys: [],
        dutyKeys: ["implements"],
        namedBefore: { roleKeys: ["translator"], dutyKeys: [] },
        before: levels,
        after: levels,
      },
    ]);
  });

  it("weighs a Pipeline chosen for a Task with none yet against no Stages", async () => {
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "backlog", pipelineId: undefined, projectId: "billing" });

    await checks.problemsOf({
      place: "On “Fix the login”",
      moves: [{ ...aMove(taskId), pipelineId: "quick-fix" }],
    });
    expect(pipelines.roleEngines.changesAsked.at(-1)?.tasks).toEqual([
      expect.objectContaining({
        dutyKeys: ["implements"],
        namedBefore: { roleKeys: [], dutyKeys: [] },
      }),
    ]);

    pipelines.roleEngines.changesAsked.length = 0;
    await checks.problemsOf({
      place: "On “Fix the login”",
      moves: [{ ...aMove(taskId), pipelineId: "not-in-the-library" }],
    });
    expect(pipelines.roleEngines.changesAsked).toEqual([]);
  });

  it("skips a Task with no Pipeline yet", async () => {
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "backlog", pipelineId: undefined });

    expect(await checks.problemsOf({ place: "In Payments", moves: [aMove(taskId)] })).toEqual([]);
    expect(pipelines.roleEngines.changesAsked).toEqual([]);
  });
});

describe("TaskRoleEngines.of", () => {
  it("is undefined for no such Task", async () => {
    expect(await pipelines.app.get(TaskRoleEngines).of(randomUUID())).toBeUndefined();
  });
});
