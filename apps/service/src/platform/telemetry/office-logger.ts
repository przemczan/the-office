import { inspect } from "node:util";
import { ConsoleLogger, type LogLevel } from "@nestjs/common";
import {
  logs,
  SeverityNumber,
  type AttributeValue,
  type Attributes,
  type LoggerProvider,
} from "@opentelemetry/api";

const SEVERITY: Record<LogLevel, SeverityNumber> = {
  verbose: SeverityNumber.TRACE,
  debug: SeverityNumber.DEBUG,
  log: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
  fatal: SeverityNumber.FATAL,
};

// Messages logged without a context, such as Nest's own few.
const DEFAULT_LOGGER_NAME = "the-office";

/**
 * Nest's console logger that also exports each record as an OpenTelemetry log. A record emitted
 * inside a span carries its trace, so Grafana links a log line to its request. The record's logger
 * (its instrumentation scope) is the Nest context, such as "Database".
 */
export class OfficeLogger extends ConsoleLogger {
  constructor(private readonly loggerProvider: LoggerProvider = logs.getLoggerProvider()) {
    super();
  }

  protected override printMessages(
    messages: unknown[],
    context = "",
    logLevel: LogLevel = "log",
    writeStreamType?: "stdout" | "stderr",
    errorStack?: unknown,
    params?: Record<string, unknown>,
  ): void {
    super.printMessages(messages, context, logLevel, writeStreamType, errorStack, params);
    const logger = this.loggerProvider.getLogger(context || DEFAULT_LOGGER_NAME);
    for (const message of messages) {
      logger.emit({
        severityNumber: SEVERITY[logLevel],
        severityText: logLevel.toUpperCase(),
        body: describe(message),
        attributes: recordAttributes(errorStack, params),
      });
    }
  }
}

function recordAttributes(errorStack: unknown, params: Record<string, unknown> = {}): Attributes {
  const attributes: Attributes = {};
  for (const [name, value] of Object.entries(params)) attributes[name] = toAttributeValue(value);
  if (typeof errorStack === "string") attributes["exception.stacktrace"] = errorStack;
  return attributes;
}

function toAttributeValue(value: unknown): AttributeValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : describe(value);
}

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  return inspect(value);
}
