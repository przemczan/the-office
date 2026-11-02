import { Injectable } from "@nestjs/common";
import type { EngineId } from "../domain/engines.js";
import type { ReadingSource } from "../domain/usage-windows.js";
import {
  pooledRatios,
  POOLED_SAMPLES,
  sampleBetween,
  type PairedReading,
  type UsageWindowRatios,
} from "../domain/usage-window-samples.js";
import { UsageWindowSampleRepository } from "../ports/usage-window-sample-repository.js";
import { countedTokens } from "../ports/session-events.js";
import type { UsageWindowReading } from "./usage-window-state.js";

/**
 * What the account's windows move by per token, Office-wide (spec §5.4): each reading is paired
 * with the last of its Reading source on its engine id, and the pairs that count are kept.
 */
@Injectable()
export class UsageWindowSamples {
  /**
   * The last reading of each engine id and source. In memory, as the Office's tokens are, so no
   * pair spans a restart.
   */
  private readonly lastReadings = new Map<EngineId, Map<ReadingSource, PairedReading>>();

  constructor(private readonly repository: UsageWindowSampleRepository) {}

  /** Pairs `reading` with the last of its source; a reading of no known source pairs with none. */
  async add(engineId: EngineId, reading: UsageWindowReading): Promise<void> {
    if (reading.source === undefined) return;
    const paired: PairedReading = {
      ...reading,
      officeTokens: countedTokens(reading.officeTokensSoFar),
    };
    const bySource = this.lastReadings.get(engineId) ?? new Map<ReadingSource, PairedReading>();
    const earlier = bySource.get(reading.source);
    // With no turn ended since, the earlier reading stays the start, so what moves now counts later.
    if (earlier !== undefined && paired.officeTokens <= earlier.officeTokens) return;
    bySource.set(reading.source, paired);
    this.lastReadings.set(engineId, bySource);
    const sample = earlier === undefined ? undefined : sampleBetween(earlier, paired);
    if (sample !== undefined) await this.repository.add(engineId, sample, POOLED_SAMPLES);
  }

  /** Window % per counted token over the latest pairs on `engineId`. */
  async ratios(engineId: EngineId): Promise<UsageWindowRatios> {
    return pooledRatios(await this.repository.latest(engineId, POOLED_SAMPLES));
  }

  /** Drops `engineId`'s pairs and last readings, so its next reading pairs with none. */
  async forget(engineId: EngineId): Promise<void> {
    this.lastReadings.delete(engineId);
    await this.repository.forget(engineId);
  }
}
