import { randomUUID } from "node:crypto";
import { gateRefusalSchema } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { StageInterpreter } from "../../application/stage-interpreter.js";
import type { Stage } from "../../domain/stage.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";

const stages: readonly Stage[] = [
  anAgentStage("implement", { name: "Implement" }),
  { kind: "script", key: "ship", name: "Ship", optional: false, command: "build" },
];

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

async function post(taskId: string, body: unknown): Promise<Response> {
  return fetch(`${await pipelines.app.getUrl()}/api/tasks/${taskId}/restart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A Task the user paused once its first Stage ended, so its last run is the held one. */
async function pausedTask(): Promise<string> {
  const taskId = randomUUID();
  await walkStages(pipelines, stages, taskId);
  pipelines.tasks.put(taskId, { state: "paused", pipelineId: "for-tests" });
  return taskId;
}

describe("POST /api/tasks/:id/restart", () => {
  it("restarts the paused Task from the chosen Stage with the feedback, answering 204", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = await pausedTask();

    const response = await post(taskId, { stageKey: "ship", feedback: "Build it again." });
    await pipelines.app.get(StageInterpreter).walked(taskId);

    expect(response.status).toBe(204);
    const runs = await runsOf(pipelines, taskId);
    expect(runs.map(({ stageKey }) => stageKey)).toEqual(["implement", "ship", "ship"]);
    expect(runs[1]?.restart).toMatchObject({ stageKey: "ship", feedback: "Build it again." });
    expect(runs[2]?.restarted).toMatchObject({ feedback: "Build it again." });
  });

  it("refuses a Stage not of the Task's Pipeline and a Task not paused, with the reasons", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = await pausedTask();

    const unknown = await post(taskId, { stageKey: "deploy" });
    expect(unknown.status).toBe(422);
    expect(gateRefusalSchema.parse(await unknown.json()).reasons).toEqual([
      `"deploy" isn't a Stage of the Task's Pipeline.`,
    ]);

    pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });
    const running = await post(taskId, { stageKey: "implement" });
    expect(running.status).toBe(422);
    expect(gateRefusalSchema.parse(await running.json()).reasons).toEqual([
      "Only a Task the user paused or stopped can be restarted.",
    ]);
    expect((await post(taskId, { feedback: "No Stage." })).status).toBe(400);
  });
});
