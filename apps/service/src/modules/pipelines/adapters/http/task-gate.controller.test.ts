import { gateRefusalSchema, taskStagesSchema } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { StageInterpreter } from "../../application/stage-interpreter.js";
import type { Stage } from "../../domain/stage.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";

const stages: readonly Stage[] = [
  anAgentStage("implement", { name: "Implement" }),
  { kind: "gate", key: "look", name: "Look", optional: false },
  { kind: "script", key: "ship", name: "Ship", optional: false, command: "build" },
];

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

async function post(taskId: string, action: string, body: unknown = {}): Promise<Response> {
  return fetch(`${await pipelines.app.getUrl()}/api/tasks/${taskId}/gate/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/tasks/:id/gate/…", () => {
  it("sends the work back with the feedback, answering the Task's Stages", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const taskId = await walkStages(pipelines, stages);

    const response = await post(taskId, "send-back", {
      stageKey: "implement",
      feedback: "Name the button Save.",
    });
    await pipelines.app.get(StageInterpreter).walked(taskId);

    expect(response.status).toBe(200);
    const { stages: after } = taskStagesSchema.parse(await response.json());
    expect(after?.[1]?.runs[0]?.gateAction).toEqual({
      kind: "send-back",
      stageKey: "implement",
      feedback: "Name the button Save.",
    });
  });

  it("refuses feedback with nothing in it, and an action where no Gate waits, with the reasons", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = await walkStages(pipelines, stages);

    expect((await post(taskId, "send-back", { stageKey: "implement", feedback: " " })).status).toBe(
      400,
    );
    expect((await post(taskId, "continue")).status).toBe(200);
    await pipelines.app.get(StageInterpreter).walked(taskId);

    const refused = await post(taskId, "drop");
    expect(refused.status).toBe(422);
    expect(gateRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "The Task isn't waiting at a Gate.",
    ]);
  });
});
