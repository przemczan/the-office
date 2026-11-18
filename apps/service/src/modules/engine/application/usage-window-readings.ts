import { Injectable, Logger } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { Engine, EngineId } from "../domain/engines.js";
import type { UsageWindows } from "../domain/usage-windows.js";
import { addedTokens, NO_TOKENS, type TokenUsage } from "../ports/session-events.js";
import { UsageWindowSamples } from "./usage-window-samples.js";
import { UsageWindowState, type UsageWindowReading } from "./usage-window-state.js";

/**
 * Keeps each reading of an engine's windows, whether a session's or a timed check's: with the
 * Office's tokens so far on that engine, in `UsageWindowState`, which announces it, and paired in
 * `UsageWindowSamples`.
 */
@Injectable()
export class UsageWindowReadings {
  private readonly logger = new Logger(UsageWindowReadings.name);
  /** Every turn's tokens on each engine since the service started, which its readings carry. */
  private readonly officeTokensSoFar = new Map<EngineId, TokenUsage>();

  constructor(
    private readonly state: UsageWindowState,
    private readonly samples: UsageWindowSamples,
    private readonly schedule: Schedule,
  ) {}

  /** Counts a turn's tokens on `engineId`, before the turn is reported. */
  turnEnded(engineId: EngineId, usage: TokenUsage): void {
    this.officeTokensSoFar.set(
      engineId,
      addedTokens(this.officeTokensSoFar.get(engineId) ?? NO_TOKENS, usage),
    );
  }

  async keep(engine: Engine, windows: UsageWindows): Promise<UsageWindowReading> {
    const reading: UsageWindowReading = {
      ...windows,
      readAt: this.schedule.now(),
      officeTokensSoFar: this.officeTokensSoFar.get(engine.id) ?? NO_TOKENS,
    };
    await this.state.update(engine, reading);
    await this.keepSample(engine.id, reading);
    return reading;
  }

  /** A failure to keep a pair of readings is logged: the reading stands. */
  private async keepSample(engineId: EngineId, reading: UsageWindowReading): Promise<void> {
    try {
      await this.samples.add(engineId, reading);
    } catch (error) {
      this.logger.error(
        `Keeping a pair of usage readings failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
