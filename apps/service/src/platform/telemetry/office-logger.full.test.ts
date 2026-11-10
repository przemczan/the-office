import { context, SeverityNumber } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { TracerProvider } from "@opentelemetry/sdk-trace";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setUp } from "./office-logger.fixtures.js";

describe("OfficeLogger", () => {
  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  });

  afterAll(() => {
    context.disable();
  });

  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports an error's stack and structured params as attributes", () => {
    const { logger, records } = setUp();

    logger.error("The migration failed", { attempt: 2, folder: "drizzle" }, "at migrate()", "Db");

    const [record] = records.getFinishedLogRecords();
    expect(record?.severityNumber).toBe(SeverityNumber.ERROR);
    expect(record?.attributes).toEqual({
      attempt: 2,
      folder: "drizzle",
      "exception.stacktrace": "at migrate()",
    });
  });

  it("describes a message that is not a string", () => {
    const { logger, records } = setUp();

    logger.log(new Error("Port 4310 is in use"), "Office");
    logger.log({ port: 4310 }, "Office");

    expect(records.getFinishedLogRecords().map((record) => record.body)).toEqual([
      "Port 4310 is in use",
      "{ port: 4310 }",
    ]);
  });

  it("exports a record logged inside a span with the span's trace", () => {
    const { logger, records } = setUp();
    const tracer = new TracerProvider().getTracer("test");

    const spanContext = tracer.startActiveSpan("GET /api/health", (span) => {
      logger.log("The database is up", "Database");
      span.end();
      return span.spanContext();
    });

    expect(records.getFinishedLogRecords()[0]?.spanContext).toEqual(spanContext);
  });

  it("names records logged without a context after The Office", () => {
    const { logger, records } = setUp();

    logger.log("Started");

    expect(records.getFinishedLogRecords()[0]?.instrumentationScope.name).toBe("the-office");
  });
});
