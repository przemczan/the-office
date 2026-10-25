import {
  SpanStatusCode,
  type Attributes,
  type Counter,
  type Meter,
  type Span,
  type Tracer,
} from "@opentelemetry/api";

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

/** Office-namespaced: the GenAI conventions count cached tokens inside input tokens. */
const TOKENS_METRIC = "office.tokens";
const TOKEN_TYPE_ATTRIBUTE = "office.token.type";
const TOKEN_TYPES = {
  input: "input",
  output: "output",
  cacheRead: "cache_read",
  cacheCreation: "cache_creation",
} as const satisfies Record<keyof TokenUsage, string>;

/**
 * What modules use for telemetry of their own: spans around their work and the tokens their engine
 * calls use. HTTP requests and database queries are traced without it.
 */
export class Telemetry {
  private readonly tokens: Counter;

  constructor(
    private readonly tracer: Tracer,
    meter: Meter,
  ) {
    this.tokens = meter.createCounter(TOKENS_METRIC, {
      description: "Tokens used by engine calls, by token type",
      unit: "{token}",
    });
  }

  /**
   * Runs work inside a new span, the child of the active one. Spans the work starts, its queries
   * and its logs belong to it. A failure is recorded on the span and rethrown.
   */
  inSpan<T>(name: string, attributes: Attributes, work: (span: Span) => Promise<T>): Promise<T> {
    return this.tracer.startActiveSpan(name, { attributes }, async (span) => {
      try {
        return await work(span);
      } catch (error) {
        recordFailure(span, error);
        throw error;
      } finally {
        span.end();
      }
    });
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
}

function recordFailure(span: Span, error: unknown): void {
  if (error instanceof Error) span.recordException(error);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : String(error),
  });
}
