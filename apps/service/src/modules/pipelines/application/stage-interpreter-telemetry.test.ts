import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Telemetry } from "../../../platform/telemetry/telemetry.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  answerLastDecision,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";

const asking = anAgentSession({
  status: "needs_decision",
  summary: "Asked which page.",
  decision: {
    question: "Which page?",
    context: "Both list devices.",
    options: ["The device page", "The list"],
    recommendation: { option: 0, reason: "It has the room." },
  },
});

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
    const taskId = await walkStages(pipelines, [anAgentStage("draft")]);
    await answerLastDecision(pipelines, taskId, { kind: "option", option: 0 });

    const [first, again] = named("walk");
    const stages = named("stage");
    const engineCalls = named("engine call");
    expect(first?.parentSpanContext).toBeUndefined();
    expect(first?.attributes).toMatchObject({ "office.task.id": taskId });
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
});
