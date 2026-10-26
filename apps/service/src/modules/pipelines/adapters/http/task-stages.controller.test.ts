import { randomUUID } from "node:crypto";
import { taskStagesSchema, type TaskStages } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
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

const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
  onFailure: { goBackTo: "implement", rounds: 2 },
};

let pipelines: PipelinesApplication | undefined;

afterEach(async () => {
  await pipelines?.app.close();
});

async function stagesOf(taskId: string): Promise<TaskStages> {
  if (!pipelines) throw new Error("The application isn't started.");
  const response = await fetch(`${await pipelines.app.getUrl()}/api/tasks/${taskId}/stages`);
  expect(response.status).toBe(200);
  return taskStagesSchema.parse(await response.json());
}

describe("GET /api/tasks/:id/stages", () => {
  it("is null for a Task without Stages of its own: one not started yet", async () => {
    pipelines = await startPipelinesApplication();

    expect(await stagesOf(randomUUID())).toEqual({ stages: null });
  });

  it("gives each of the Task's own Stages with where it stands, its tokens and its runs", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult("Added the field.", "The form is done; check the list.")),
    ]);
    const taskId = await walkStages(pipelines, [anAgentStage("implement"), tests]);
    const [run] = await runsOf(pipelines, taskId);

    const { stages } = await stagesOf(taskId);

    expect(stages?.map(({ stage, state, tokens }) => [stage.key, state, tokens])).toEqual([
      ["implement", "done", 20],
      ["tests", "done", 0],
    ]);
    expect(stages?.[0]?.runs).toEqual([
      {
        id: run?.id,
        number: 1,
        startedAt: run?.startedAt.toISOString(),
        endedAt: run?.endedAt?.toISOString(),
        threadId: run?.threadId,
        session: "fresh",
        tokens: { input: 10, output: 10, cacheRead: 0, cacheCreation: 0 },
        carriedFailure: null,
        commandRuns: [],
        outcome: {
          status: "done",
          summary: "Added the field.",
          skipped: false,
          handoverNote: "The form is done; check the list.",
        },
      },
    ]);
    expect(stages?.[1]?.runs[0]?.commandRuns).toMatchObject([
      { purpose: "command", outcome: "passed" },
    ]);
  });
});
