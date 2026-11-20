import { gateRefusalSchema, taskStagesSchema } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { StageInterpreter } from "../../application/stage-interpreter.js";
import type { Stage } from "../../domain/stage.js";
import { StartedTasksForTests } from "../../ports/pipelines-ports.fixtures.js";
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

/** A POST with no body at all, as a client that sends none would. */
async function postWithoutBody(taskId: string, action: string): Promise<Response> {
  return fetch(`${await pipelines.app.getUrl()}/api/tasks/${taskId}/gate/${action}`, {
    method: "POST",
  });
}

async function gateActionAfter(response: Response): Promise<unknown> {
  const { stages: after } = taskStagesSchema.parse(await response.json());
  return after?.[1]?.runs[0]?.gateAction;
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

  it("drops the Task with the reason the body gives, which Work keeps with the move", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = await walkStages(pipelines, stages);

    const response = await post(taskId, "drop", { reason: { kind: "wont-fix" } });
    await pipelines.app.get(StageInterpreter).walked(taskId);

    expect(response.status).toBe(200);
    expect(pipelines.app.get(StartedTasksForTests).changes).toContainEqual({
      taskId,
      state: "dropped",
      dropReason: { kind: "wont-fix" },
    });
  });

  it("refuses a Duplicate of the Task itself or of no Task, keeping the Gate waiting", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = await walkStages(pipelines, stages);
    const unknown = "00000000-0000-4000-8000-000000000000";

    const itself = await post(taskId, "drop", { reason: { kind: "duplicate", taskId } });
    const none = await post(taskId, "drop", { reason: { kind: "duplicate", taskId: unknown } });

    expect(itself.status).toBe(422);
    expect(gateRefusalSchema.parse(await itself.json()).reasons).toEqual([
      "A Task can't be a duplicate of itself.",
    ]);
    expect(none.status).toBe(422);
    expect(gateRefusalSchema.parse(await none.json()).reasons).toEqual([
      `There is no Task ${unknown}.`,
    ]);
    expect((await post(taskId, "drop")).status).toBe(200);
  });

  it("continues with no body as plain Continue", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = await walkStages(pipelines, stages);

    const response = await postWithoutBody(taskId, "continue");
    await pipelines.app.get(StageInterpreter).walked(taskId);

    expect(response.status).toBe(200);
    expect(await gateActionAfter(response)).toEqual({ kind: "continue" });
  });

  it("keeps the notes Continue brings when an Agent Stage comes after the Gate", async () => {
    const reviewed = [...stages.slice(0, 2), anAgentStage("review", { name: "Review" })];
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const taskId = await walkStages(pipelines, reviewed);

    const response = await post(taskId, "continue", { feedback: " Build version B. " });
    await pipelines.app.get(StageInterpreter).walked(taskId);

    expect(response.status).toBe(200);
    expect(await gateActionAfter(response)).toEqual({
      kind: "continue",
      feedback: "Build version B.",
    });
  });

  it("refuses notes no Agent Stage after the Gate reads, and takes blank notes as plain Continue", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = await walkStages(pipelines, stages);

    const refused = await post(taskId, "continue", { feedback: "Build version B." });
    expect(refused.status).toBe(422);
    expect(gateRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "No Agent Stage after the Gate reads your notes: continue without them.",
    ]);

    const blank = await post(taskId, "continue", { feedback: "  " });
    await pipelines.app.get(StageInterpreter).walked(taskId);
    expect(blank.status).toBe(200);
    expect(await gateActionAfter(blank)).toEqual({ kind: "continue" });
  });
});
