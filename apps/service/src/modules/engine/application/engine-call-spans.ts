import type {
  Telemetry,
  TelemetryAttributes,
  TelemetrySpan,
} from "../../../platform/telemetry/telemetry.js";
import type { EngineModel } from "../domain/engines.js";
import type { TurnEndedEvent } from "../ports/session-events.js";
import type { SessionOptions } from "../ports/session-options.js";
import type { ModelPrices } from "./model-prices.js";

const ENGINE_CALL = "engine call";

/** The caller's attributes an `office.engine.call` record always holds, `""` where none applies. */
const CALLER_RECORD_KEYS = [
  "office.task",
  "office.initiative",
  "office.thread",
  "office.stage",
  "office.stage.run",
  "office.role",
  "office.pipeline",
  "office.project",
] as const;

/** What a session's caller tags its engine calls with, beside the engine's own attributes. */
export interface SessionTelemetry {
  /** On each call's span, such as the Thread it answers. */
  readonly span: TelemetryAttributes;
  /** On its tokens and cost: few distinct values each, as metric attributes must have. */
  readonly metric: TelemetryAttributes;
}

/**
 * Each session's cost so far as last reported, so a turn's cost is the difference, across a
 * resume too while The Office runs. The engine reports a session's cost only as a total.
 */
export class SessionCosts {
  private readonly totals = new Map<string, number>();

  started(sessionId: string): void {
    this.totals.set(sessionId, 0);
  }

  /** A turn's cost, from the session's total after it; undefined when the total before is unknown. */
  turnCost(sessionId: string, total: number): number | undefined {
    const before = this.totals.get(sessionId);
    this.totals.set(sessionId, total);
    return before === undefined ? undefined : total - before;
  }
}

/** The prompt features a session's calls use, so telemetry compares calls by them (spec §5.2). */
export function promptFeatures(options: SessionOptions): string[] {
  return [
    ...(options.skills === undefined ? [] : ["skills"]),
    ...options.officeTools.map((tool) => `office-tool:${tool.name}`),
  ].toSorted();
}

/** An engine call that ended with its turn. */
export interface EndedCall {
  readonly turn: TurnEndedEvent;
  readonly durationMs: number;
}

/** What one call cost: estimated from Model prices, and as the engine reported it. */
export interface CallCost {
  readonly estimatedUsd: number | undefined;
  readonly engineReportedUsd: number | undefined;
}

/**
 * The attributes of one call's `office.engine.call` record (spec §5.2): the caller's, each `""`
 * where none applies, then the engine's, the call's tokens and its costs where known.
 */
export function engineCallRecord(
  spentOn: EngineModel,
  caller: SessionTelemetry | undefined,
  { turn, durationMs }: EndedCall,
  cost: CallCost,
): TelemetryAttributes {
  return {
    ...Object.fromEntries(CALLER_RECORD_KEYS.map((key) => [key, ""])),
    ...caller?.span,
    ...caller?.metric,
    "office.engine": spentOn.engineId,
    "office.engine.model": spentOn.model,
    "office.engine.outcome": turn.outcome,
    "office.engine.call.duration_ms": durationMs,
    "office.tokens.input": turn.usage.input,
    "office.tokens.output": turn.usage.output,
    "office.tokens.cache_read": turn.usage.cacheRead,
    "office.tokens.cache_creation": turn.usage.cacheCreation,
    ...(cost.estimatedUsd === undefined ? {} : { "office.cost.estimated_usd": cost.estimatedUsd }),
    ...(cost.engineReportedUsd === undefined
      ? {}
      : { "office.cost.engine_reported_usd": cost.engineReportedUsd }),
  };
}

/**
 * One span per engine call, a turn, from when it begins (a message reaching an idle session, or a
 * turn ending with messages left to take) to its end, with its tokens and estimated cost, and one
 * `office.engine.call` record per call that ends with a turn.
 */
export class EngineCallSpans {
  /** Messages sent and not yet taken by a turn. */
  private readonly waiting = new Set<string>();
  private open: OpenCall | undefined;
  /** Ends the count of the open call as busy work, which a scheduled Office update waits for. */
  private endBusy: (() => void) | undefined;
  private readonly spentOn: EngineModel;
  private readonly spanAttributes: TelemetryAttributes;
  private readonly metricAttributes: TelemetryAttributes;

  constructor(
    private readonly telemetry: Telemetry,
    private readonly costs: SessionCosts,
    private readonly prices: Pick<ModelPrices, "costOf">,
    private readonly sessionId: string,
    options: SessionOptions,
    private readonly caller: SessionTelemetry | undefined,
    private readonly countBusy: () => () => void,
  ) {
    const features = promptFeatures(options);
    this.spentOn = { engineId: options.engine.id, model: options.model };
    this.spanAttributes = {
      ...caller?.span,
      "office.engine": options.engine.id,
      "office.engine.session": sessionId,
      "office.engine.model": options.model,
      "office.prompt.features": features,
    };
    // Few distinct values each, as metric attributes must have.
    this.metricAttributes = {
      ...caller?.metric,
      "office.engine.model": options.model,
      "office.prompt.features": features.join(","),
    };
  }

  messageSent(messageId: string): void {
    this.waiting.add(messageId);
    if (this.open === undefined) this.begin();
  }

  turnEnded(turn: TurnEndedEvent): void {
    for (const messageId of turn.consumedMessageIds) this.waiting.delete(messageId);
    this.open?.end(turn);
    this.closed();
    if (this.waiting.size > 0) this.begin();
  }

  /** The session ended, or failed with `error`; a call still open ends with it. */
  stopped(error?: unknown): void {
    if (error === undefined) {
      this.open?.end(undefined);
    } else {
      this.open?.fail(error);
    }
    this.closed();
  }

  private closed(): void {
    this.open = undefined;
    this.endBusy?.();
    this.endBusy = undefined;
  }

  private begin(): void {
    const call = new OpenCall();
    this.open = call;
    this.endBusy = this.countBusy();
    this.telemetry
      .inSpan(ENGINE_CALL, this.spanAttributes, async (span) => {
        const ended = await call.ended;
        if (ended === undefined) return;
        span.setAttribute("office.engine.outcome", ended.turn.outcome);
        this.telemetry.recordTokens(span, ended.turn.usage, this.metricAttributes);
        const cost = await this.costOf(span, ended.turn);
        if (cost.estimatedUsd !== undefined) {
          this.telemetry.recordCost(span, cost.estimatedUsd, this.metricAttributes);
        }
        this.telemetry.recordEngineCall(engineCallRecord(this.spentOn, this.caller, ended, cost));
      })
      // The span keeps the failure; the session's reader gets it from the stream.
      .catch(() => undefined);
  }

  /**
   * Priced from the turn's tokens by Model prices, as Daily caps are; the engine's own report
   * stands in only for a model with no price (spec §5.2). When the prices can't be read, the call
   * has no estimate and its span keeps why, so its record is still written.
   */
  private async costOf(span: TelemetrySpan, turn: TurnEndedEvent): Promise<CallCost> {
    const engineReportedUsd = this.costs.turnCost(this.sessionId, turn.sessionCostUsd);
    try {
      const priced = await this.prices.costOf(this.spentOn, turn.usage);
      return { estimatedUsd: priced ?? engineReportedUsd, engineReportedUsd };
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      return { estimatedUsd: undefined, engineReportedUsd };
    }
  }
}

/** A call under way, which ends with its turn, or without one when the session stops first. */
class OpenCall {
  readonly ended: Promise<EndedCall | undefined>;
  end: (turn: TurnEndedEvent | undefined) => void = () => undefined;
  fail: (error: unknown) => void = () => undefined;
  private readonly begunAt = performance.now();

  constructor() {
    this.ended = new Promise((resolve, reject) => {
      this.end = (turn) =>
        resolve(turn && { turn, durationMs: Math.round(performance.now() - this.begunAt) });
      this.fail = reject;
    });
  }
}
