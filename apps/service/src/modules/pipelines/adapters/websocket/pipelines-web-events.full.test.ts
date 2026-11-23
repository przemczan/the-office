import { pipelinesWebEventSchema } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { PipelineLibraryEditor } from "../../application/pipeline-library-editor.js";
import { StageTemplateLibraryEditor } from "../../application/stage-template-library-editor.js";
import type { KeptStage } from "../../domain/routes-back.js";
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

/** Tests going back to Implement on failure, as a previous release kept the setting. */
const tests: KeptStage = {
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
      { type: "stage-run.thread-opened", taskId, stageKey: "implement" },
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
      { type: "stage-run.thread-opened", taskId, stageKey: "implement" },
      { type: "stage-run.ended", taskId, stageKey: "implement", status: "done" },
      { type: "stage-run.started", taskId, stageKey: "tests" },
      { type: "stage-run.ended", taskId, stageKey: "tests", status: "done" },
      { type: "pipeline.completed", taskId },
    ]);
  });

  it("tell the web of each Pipeline the library editor adds, saves and removes", async () => {
    pipelines = await startPipelinesApplication();
    const editor = pipelines.app.get(PipelineLibraryEditor);

    const added = await editor.add({
      name: `Web events ${crypto.randomUUID()}`,
      description: "",
      stages: [{ kind: "script", key: "build", name: "Build", optional: false, command: "build" }],
    });
    await editor.save(added.id, { ...added, description: "Builds the Project." });
    await editor.remove(added.id);

    const forwarding = pipelines.app.get(WebEventForwarding);
    const webEvents = pipelines.published.flatMap((event) => {
      const webEvent = forwarding.toWebEvent(event);
      if (!webEvent) return [];
      const { occurredAt: _occurredAt, ...rest } = pipelinesWebEventSchema.parse(webEvent);
      return [rest];
    });
    expect(webEvents).toEqual([
      { type: "pipeline.added", pipelineId: added.id },
      { type: "pipeline.saved", pipelineId: added.id },
      { type: "pipeline.removed", pipelineId: added.id },
    ]);
  });

  it("tell the web of each Stage template the editor adds, saves and removes", async () => {
    pipelines = await startPipelinesApplication();
    const editor = pipelines.app.get(StageTemplateLibraryEditor);
    const stage: Stage = {
      kind: "gate",
      key: "look",
      name: `Look ${crypto.randomUUID()}`,
      optional: false,
    };

    const added = await editor.add(stage);
    await editor.save(added.id, { ...stage, optional: true });
    await editor.remove(added.id);

    const forwarding = pipelines.app.get(WebEventForwarding);
    const webEvents = pipelines.published.flatMap((event) => {
      const webEvent = forwarding.toWebEvent(event);
      if (!webEvent) return [];
      const { occurredAt: _occurredAt, ...rest } = pipelinesWebEventSchema.parse(webEvent);
      return [rest];
    });
    expect(webEvents).toEqual([
      { type: "stage-template.added", stageTemplateId: added.id },
      { type: "stage-template.saved", stageTemplateId: added.id },
      { type: "stage-template.removed", stageTemplateId: added.id },
    ]);
  });
});
