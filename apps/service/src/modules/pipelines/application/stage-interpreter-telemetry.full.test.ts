import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Telemetry } from "../../../platform/telemetry/telemetry.js";
import { aTaskRecord } from "../ports/pipelines-ports.fixtures.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  anAskedDecision,
  answerAsked,
  asksOnce,
  A_WAITING_RESULT,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";

const asking = anAgentSession(A_WAITING_RESULT);

let pipelines: PipelinesApplication | undefined;
const spans = new InMemorySpanExporter();
const telemetry = new Telemetry(
  new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter: spans })] }).getTracer(
    "test",
  ),
  new MeterProvider().getMeter("test"),
);

// Without a context manager, the active span is not carried across awaits.
beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
});

afterAll(() => {
  context.disable();
});

afterEach(async () => {
  await pipelines?.app.close();
  spans.reset();
});

function named(name: string): ReadableSpan[] {
  return spans.getFinishedSpans().filter((span) => span.name === name);
}

function idOf(span: ReadableSpan | undefined): string | undefined {
  return span?.spanContext().spanId;
}

describe("the Stage interpreter's telemetry", () => {
  it("traces a Task in one trace, its walk after an answer too, a span per Stage run and per engine call", async () => {
    pipelines = await startPipelinesApplication(
      [asking, anAgentSession(aDoneResult())],
      undefined,
      telemetry,
    );
    const asked = anAskedDecision();
    asksOnce(pipelines, asked);
    const taskId = await walkStages(pipelines, [anAgentStage("draft")]);
    await answerAsked(pipelines, taskId, asked, { kind: "option", option: 0 });

    const [first, again] = named("walk");
    const stages = named("stage");
    const engineCalls = named("engine call");
    expect(first?.parentSpanContext).toBeUndefined();
    expect(first?.attributes).toMatchObject({
      "office.task": taskId,
      "office.pipeline": "for-tests",
    });
    expect(first?.attributes).not.toHaveProperty("office.task.id");
    expect(idOf(first) && again?.parentSpanContext?.spanId).toBe(idOf(first));
    const traceIds = new Set(
      [first, again, ...stages, ...engineCalls].map((span) => span?.spanContext().traceId),
    );
    expect(traceIds.size).toBe(1);
    expect(stages.map((span) => span.attributes)).toEqual([
      { "office.stage": "draft", "office.stage.kind": "agent", "office.stage.run": 1 },
      { "office.stage": "draft", "office.stage.kind": "agent", "office.stage.run": 2 },
    ]);
    expect(stages.map((span) => span.parentSpanContext?.spanId)).toEqual([
      idOf(first),
      idOf(again),
    ]);
    const engineCallParents = new Set(engineCalls.map((span) => span.parentSpanContext?.spanId));
    expect(engineCallParents).toEqual(new Set(stages.map(idOf)));
  });

  it("asks each Stage Thread for the Task's Initiative, the run's number and the Pipeline's and Project's names", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const initiativeId = "33333333-3333-4333-8333-333333333333";
    const taskId = randomUUID();
    pipelines.records.put(taskId, aTaskRecord({ initiativeId }));
    await walkStages(pipelines, [anAgentStage("draft")], taskId);

    expect(pipelines.stageThreads.requests).toEqual([
      expect.objectContaining({
        taskId,
        initiativeId,
        stageName: "draft",
        stageRun: 1,
        // The Pipeline the test walks is in no library, so it goes by its id.
        pipelineName: "for-tests",
        projectName: "Admin panel",
      }),
    ]);
  });
});
