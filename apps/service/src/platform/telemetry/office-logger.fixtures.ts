import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { OfficeLogger } from "./office-logger.js";

export function setUp() {
  const records = new InMemoryLogRecordExporter();
  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter: records })],
  });
  return { logger: new OfficeLogger(loggerProvider), records };
}
