import { afterEach, describe, expect, it } from "vitest";
import type { Stage } from "../domain/stage.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { GateService } from "./gate-service.js";
import { StageInterpreter } from "./stage-interpreter.js";
import { TaskStagesService } from "./task-stages-service.js";

const draft = anAgentStage("draft");
const look: Stage = { kind: "gate", key: "look", name: "Look", optional: false };
const ship: Stage = {
  kind: "script",
  key: "ship",
  name: "Ship",
  optional: false,
  command: "build",
};
const polish = anAgentStage("polish", { effort: "low" });
const lookAgain: Stage = { kind: "gate", key: "look-again", name: "Look again", optional: false };

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

async function continueAt(taskId: string): Promise<void> {
  await pipelines.app.get(GateService).continue(taskId);
  await pipelines.app.get(StageInterpreter).walked(taskId);
}

async function statusesOf(taskId: string): Promise<[string, string | undefined][]> {
  return (await runsOf(pipelines, taskId)).map(({ stageKey, outcome }) => [
    stageKey,
    outcome?.status,
  ]);
}

describe("A Task's Stages edited for the Task", () => {
  it("are what the walk goes on with: an Agent Stage with its own effort, and a Gate before the last", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const taskId = await walkStages(pipelines, [draft, look, ship]);

    await pipelines.app.get(TaskStagesService).edit(taskId, [draft, look, polish, lookAgain, ship]);
    await continueAt(taskId);

    expect(await statusesOf(taskId)).toEqual([
      ["draft", "done"],
      ["look", "done"],
      ["polish", "done"],
      ["look-again", "done"],
    ]);
    expect(pipelines.stageThreads.requests.at(-1)).toMatchObject({
      stageName: "polish",
      effort: "low",
    });

    await continueAt(taskId);

    expect((await statusesOf(taskId)).at(-1)).toEqual(["ship", "done"]);
  });
});
