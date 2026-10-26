import { pipelinesWebEventSchema } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import type { Stage } from "../../domain/stage.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import { aCommandRun } from "../../ports/pipelines-ports.fixtures.js";

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

describe("Pipelines' web events", () => {
  it("tell the web of each Stage run and of the walk going back and completing", async () => {
    const done = anAgentSession(aDoneResult());
    pipelines = await startPipelinesApplication([done, done]);
    pipelines.commands.commandRuns.push([aCommandRun("npm test", "failed", "1 test fails.")]);

    const taskId = await walkStages(pipelines, [anAgentStage("implement"), tests]);

    const forwarding = pipelines.app.get(WebEventForwarding);
    const webEvents = pipelines.published
      .filter((event) => forwarding.toWebEvent(event) !== undefined)
      .map((event) => {
        const { occurredAt: _occurredAt, ...webEvent } = pipelinesWebEventSchema.parse(
          forwarding.toWebEvent(event),
        );
        return webEvent;
      });
    expect(webEvents).toEqual([
      { type: "stage-run.started", taskId, stageKey: "implement" },
      { type: "stage-run.ended", taskId, stageKey: "implement", status: "done" },
      { type: "stage-run.started", taskId, stageKey: "tests" },
      { type: "stage-run.ended", taskId, stageKey: "tests", status: "failed" },
      {
        type: "stage-run.went-back",
        taskId,
        fromStageKey: "tests",
        toStageKey: "implement",
        round: 1,
        rounds: 2,
      },
      { type: "stage-run.started", taskId, stageKey: "implement" },
      { type: "stage-run.ended", taskId, stageKey: "implement", status: "done" },
      { type: "stage-run.started", taskId, stageKey: "tests" },
      { type: "stage-run.ended", taskId, stageKey: "tests", status: "done" },
      { type: "pipeline.completed", taskId },
    ]);
  });
});
