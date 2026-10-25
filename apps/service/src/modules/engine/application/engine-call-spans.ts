import type { Telemetry, TelemetryAttributes } from "../../../platform/telemetry/telemetry.js";
import type { TurnEndedEvent } from "../ports/session-events.js";
import type { SessionOptions } from "../ports/session-options.js";

const ENGINE_CALL = "engine call";

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

/**
 * One span per engine call, a turn, from when it begins (a message reaching an idle session, or a
 * turn ending with messages left to take) to its end, with its tokens and cost.
 */
export class EngineCallSpans {
  /** Messages sent and not yet taken by a turn. */
  private readonly waiting = new Set<string>();
  private open: OpenCall | undefined;
  private readonly spanAttributes: TelemetryAttributes;
  private readonly metricAttributes: TelemetryAttributes;

  constructor(
    private readonly telemetry: Telemetry,
    private readonly costs: SessionCosts,
    private readonly sessionId: string,
    options: SessionOptions,
  ) {
    const features = promptFeatures(options);
    this.spanAttributes = {
      "office.engine.session": sessionId,
      "office.engine.model": options.model,
      "office.prompt.features": features,
    };
    // Few distinct values each, as metric attributes must have.
    this.metricAttributes = {
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
    this.open = undefined;
    if (this.waiting.size > 0) this.begin();
  }

  /** The session ended, or failed with `error`; a call still open ends with it. */
  stopped(error?: unknown): void {
    if (error === undefined) {
      this.open?.end(undefined);
    } else {
      this.open?.fail(error);
    }
    this.open = undefined;
  }

  private begin(): void {
    const call = new OpenCall();
    this.open = call;
    this.telemetry
      .inSpan(ENGINE_CALL, this.spanAttributes, async (span) => {
        const turn = await call.ended;
        if (turn === undefined) return;
        span.setAttribute("office.engine.outcome", turn.outcome);
        this.telemetry.recordTokens(span, turn.usage, this.metricAttributes);
        const cost = this.costs.turnCost(this.sessionId, turn.sessionCostUsd);
        if (cost !== undefined) this.telemetry.recordCost(span, cost, this.metricAttributes);
      })
      // The span keeps the failure; the session's reader gets it from the stream.
      .catch(() => undefined);
  }
}

/** A call under way, which ends with its turn, or without one when the session stops first. */
class OpenCall {
  readonly ended: Promise<TurnEndedEvent | undefined>;
  end: (turn: TurnEndedEvent | undefined) => void = () => undefined;
  fail: (error: unknown) => void = () => undefined;

  constructor() {
    this.ended = new Promise((resolve, reject) => {
      this.end = resolve;
      this.fail = reject;
    });
  }
}
