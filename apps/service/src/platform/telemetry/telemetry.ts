import {
  logs,
  ROOT_CONTEXT,
  SeverityNumber,
  SpanStatusCode,
  TraceFlags,
  trace,
  type Attributes,
  type Counter,
  type Gauge,
  type Logger,
  type Meter,
  type Span,
  type Tracer,
} from "@opentelemetry/api";

/** What spans and metrics are described by: names to strings, numbers, booleans or arrays of them. */
export type TelemetryAttributes = Attributes;

/** A span work runs in, as `inSpan` hands it. */
export type TelemetrySpan = Span;

/**
 * The tokens one engine call used, split as the engine reports them. The four parts add up to the
 * call's tokens; none of them includes another.
 */
export interface TokenUsage {
  /** Input tokens neither read from nor written to the prompt cache. */
  readonly input: number;
  readonly output: number;
  /** Input tokens read from the prompt cache. */
  readonly cacheRead: number;
  /** Input tokens written to the prompt cache. */
  readonly cacheCreation: number;
}

/**
 * A trace's first span, kept by the module whose work it traces so work done later, in another
 * request or after a restart, joins the same trace.
 */
export interface TraceRoot {
  readonly traceId: string;
  readonly spanId: string;
}

/** Office-namespaced: the GenAI conventions count cached tokens inside input tokens. */
const TOKENS_METRIC = "office.tokens";
const COST_METRIC = "office.cost";
const TOKEN_TYPE_ATTRIBUTE = "office.token.type";
const USAGE_WINDOW_METRIC = "office.usage_window.used";
const ENGINE_CALL_RECORD = "office.engine.call";
/** The instrumentation scope of the spans, metrics and logs modules record through Telemetry. */
export const TELEMETRY_SCOPE = "the-office";
const TOKEN_TYPES = {
  input: "input",
  output: "output",
  cacheRead: "cache_read",
  cacheCreation: "cache_creation",
} as const satisfies Record<keyof TokenUsage, string>;

/** A Usage window as the `office.usage_window` attribute names it. */
export type UsageWindowAttribute = "five_hour" | "seven_day";

/**
 * What modules use for telemetry of their own: spans around their work, the tokens and estimated
 * cost their engine calls use, one log record per engine call and how full the Usage windows are.
 * HTTP requests and database queries are traced without it.
 */
export class Telemetry {
  private readonly tokens: Counter;
  private readonly cost: Counter;
  private readonly usageWindowUsed: Gauge;

  constructor(
    private readonly tracer: Tracer,
    meter: Meter,
    private readonly logger: Logger = logs.getLogger(TELEMETRY_SCOPE),
  ) {
    this.tokens = meter.createCounter(TOKENS_METRIC, {
      description: "Tokens used by engine calls, by token type",
      unit: "{token}",
    });
    this.cost = meter.createCounter(COST_METRIC, {
      description: "The estimated cost of engine calls, priced from Model prices",
      unit: "USD",
    });
    this.usageWindowUsed = meter.createGauge(USAGE_WINDOW_METRIC, {
      description: "How full an engine's Usage window is, at its last reading",
      unit: "%",
    });
  }

  /**
   * Runs work inside a new span, the child of the active one. Spans the work starts, its queries
   * and its logs belong to it. A failure is recorded on the span and rethrown.
   */
  inSpan<T>(name: string, attributes: Attributes, work: (span: Span) => Promise<T>): Promise<T> {
    return this.tracer.startActiveSpan(name, { attributes }, (span) => runIn(span, work));
  }

  /**
   * Runs work inside a new span of the trace `root` names, as a child of its first span, whatever
   * span is active; without a root, the span starts a trace of its own, and work gets its root to
   * keep. One piece of work traced over several requests is one trace this way.
   */
  inTrace<T>(
    name: string,
    attributes: Attributes,
    root: TraceRoot | undefined,
    work: (span: Span, root: TraceRoot) => Promise<T>,
  ): Promise<T> {
    if (!root) {
      return this.tracer.startActiveSpan(name, { attributes, root: true }, (span) => {
        const { traceId, spanId } = span.spanContext();
        return runIn(span, () => work(span, { traceId, spanId }));
      });
    }
    const parent = trace.setSpanContext(ROOT_CONTEXT, {
      ...root,
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    });
    return this.tracer.startActiveSpan(name, { attributes }, parent, (span) =>
      runIn(span, () => work(span, root)),
    );
  }

  /**
   * Counts an engine call's tokens and puts them on its span. Attributes go on the metric too, so
   * they must have few distinct values (a model, a Role), never an id.
   */
  recordTokens(span: Span, usage: TokenUsage, attributes: Attributes = {}): void {
    for (const part of Object.keys(TOKEN_TYPES) as (keyof TokenUsage)[]) {
      const type = TOKEN_TYPES[part];
      this.tokens.add(usage[part], { ...attributes, [TOKEN_TYPE_ATTRIBUTE]: type });
      span.setAttribute(`${TOKENS_METRIC}.${type}`, usage[part]);
    }
  }

  /**
   * Counts an engine call's estimated cost in US dollars and puts it on its span; attributes as
   * for tokens.
   */
  recordCost(span: Span, usd: number, attributes: Attributes = {}): void {
    this.cost.add(usd, attributes);
    span.setAttribute(`${COST_METRIC}.usd`, usd);
  }

  /**
   * Writes one engine call's log record. Written in the active span, the call's own, it carries
   * its trace. Unlike a metric's, its attributes may be ids, such as the Task's.
   */
  recordEngineCall(attributes: Attributes): void {
    this.logger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      eventName: ENGINE_CALL_RECORD,
      body: ENGINE_CALL_RECORD,
      attributes,
    });
  }

  /** Records how full one engine's Usage window is, in percent, at a reading of it. */
  recordUsageWindow(engineId: string, window: UsageWindowAttribute, percentUsed: number): void {
    this.usageWindowUsed.record(percentUsed, {
      "office.engine": engineId,
      "office.usage_window": window,
    });
  }
}

/** A failure is recorded on the span and rethrown; the span ends either way. */
async function runIn<T>(span: Span, work: (span: Span) => Promise<T>): Promise<T> {
  try {
    return await work(span);
  } catch (error) {
    recordFailure(span, error);
    throw error;
  } finally {
    span.end();
  }
}

function recordFailure(span: Span, error: unknown): void {
  if (error instanceof Error) span.recordException(error);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : String(error),
  });
}
