import { context, SeverityNumber } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { TracerProvider } from "@opentelemetry/sdk-trace";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { OfficeLogger } from "./office-logger.js";

function setUp() {
  const records = new InMemoryLogRecordExporter();
  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter: records })],
  });
  return { logger: new OfficeLogger(loggerProvider), records };
}

describe("OfficeLogger", () => {
  let stdout: MockInstance<typeof process.stdout.write>;

  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  });

  afterAll(() => {
    context.disable();
  });

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints a message and exports it with its level, under its context", () => {
    const { logger, records } = setUp();

    logger.warn("An idle database connection failed", "Database");

    expect(stdout).toHaveBeenCalledOnce();
    const [record] = records.getFinishedLogRecords();
    expect(record?.instrumentationScope.name).toBe("Database");
    expect(record?.severityNumber).toBe(SeverityNumber.WARN);
    expect(record?.severityText).toBe("WARN");
    expect(record?.body).toBe("An idle database connection failed");
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
