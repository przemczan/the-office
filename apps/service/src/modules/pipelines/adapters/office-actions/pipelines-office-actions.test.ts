import { randomUUID } from "node:crypto";
import {
  EDIT_TASK_STAGES_ACTION,
  SWITCH_TO_STAND_IN_ACTION,
  standInSwitchResponseSchema,
  taskStagesSchema,
} from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { anOfficeToolCall, RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { straightLine } from "../../domain/stage.fixtures.js";
import {
  anAgentStage,
  startPipelinesApplication,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import { SessionPeopleForTests } from "../../ports/pipelines-ports.fixtures.js";

const SESSION = "editor-session";

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

function callTool(name: string, input: Record<string, unknown>) {
  const [tool] = pipelines.app.get(OfficeToolRegistry).named([name], RUN_EVERY_CALL);
  if (!tool) throw new Error(`No Office tool ${name}.`);
  return tool.run(input, anOfficeToolCall(SESSION));
}

describe("the Office tools of Moving work in Pipelines", () => {
  it("are ruled by the Moving work group, each with the declared input", async () => {
    pipelines = await startPipelinesApplication();
    const registry = pipelines.app.get(OfficeToolRegistry);

    for (const action of [EDIT_TASK_STAGES_ACTION, SWITCH_TO_STAND_IN_ACTION]) {
      const [tool] = registry.named([action.name], RUN_EVERY_CALL);
      expect(tool).toMatchObject({
        description: action.description,
        authority: { group: "movingWork" },
        input: action.input,
      });
    }
  });

  it("edit_task_stages saves the Stages as the route does", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "ready", pipelineId: "quick-fix" });
    const stages = [anAgentStage("implement", { effort: "low" })];

    const result = await callTool("edit_task_stages", { taskId, stages });

    expect(result.isError).toBe(false);
    const response = await fetch(`${await pipelines.app.getUrl()}/api/tasks/${taskId}/stages`);
    const saved = taskStagesSchema.parse(await response.json());
    expect(saved.editedForTask).toBe(true);
    expect(saved.stages?.map(({ stage }) => stage)).toEqual(straightLine(stages));
  });

  it("switch_to_stand_in answers each run as the route does", async () => {
    pipelines = await startPipelinesApplication();
    pipelines.app.get(SessionPeopleForTests).asked = { userId: "user-ann", name: "Ann Lee" };
    const runId = randomUUID();

    const route = await fetch(`${await pipelines.app.getUrl()}/api/stand-in-choices/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runIds: [runId] }),
    });
    const tool = await callTool(SWITCH_TO_STAND_IN_ACTION.name, { runIds: [runId] });

    expect(route.status).toBe(200);
    const [result] = standInSwitchResponseSchema.parse(await route.json()).results;
    expect(result).toMatchObject({ runId, outcome: "no-longer-waiting" });
    expect(tool).toEqual({ text: result?.words, isError: false });
  });
});
