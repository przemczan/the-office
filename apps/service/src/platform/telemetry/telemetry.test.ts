import { context, SpanStatusCode } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setUp } from "./telemetry.fixtures.js";

describe("Telemetry", () => {
  // Without a context manager, the active span is not carried across awaits.
  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  });

  afterAll(() => {
    context.disable();
  });

  it("runs work in a span with the given name and attributes, and ends it", async () => {
    const { telemetry, spans } = setUp();

    const result = await telemetry.inSpan("stage", { "office.stage": "Implement" }, async () => {
      await Promise.resolve();
      return "done";
    });

    expect(result).toBe("done");
    const [span] = spans.getFinishedSpans();
    expect(span?.name).toBe("stage");
    expect(span?.attributes).toEqual({ "office.stage": "Implement" });
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
  });
});
