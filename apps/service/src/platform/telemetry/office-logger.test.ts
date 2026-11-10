import { context, SeverityNumber } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
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
import { setUp } from "./office-logger.fixtures.js";

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
});
