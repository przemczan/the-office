import { Injectable } from "@nestjs/common";
import type { EngineId } from "../../engine/index.js";
import type { EngineUsage, UsageWindowName } from "../domain/usage-estimate.js";

interface StartWithEstimate {
  readonly at: Date;
  readonly estimate: readonly EngineUsage[];
}

/**
 * The Tasks started since the windows were last read, with what each is expected to use: a reading
 * doesn't show their use yet (spec §2.1). Kept in memory, as the readings are, so a restart forgets
 * both.
 */
@Injectable()
export class StartsSinceReading {
  private starts: StartWithEstimate[] = [];

  /** Only the engines with usage windows are kept: no reading ever shows the rest's use. */
  record(at: Date, estimate: readonly EngineUsage[]): void {
    const withWindows = estimate.filter(({ windows }) => windows !== undefined);
    if (withWindows.length > 0) this.starts.push({ at, estimate: withWindows });
  }

  /**
   * A new reading of `engineId`'s windows shows what the Tasks started before it used there; what
   * they are expected to use on the other engines still counts until those are read.
   */
  forgetUntil(engineId: EngineId, readAt: Date): void {
    this.starts = this.starts
      .map((start) =>
        start.at > readAt
          ? start
          : { ...start, estimate: start.estimate.filter((usage) => usage.engineId !== engineId) },
      )
      .filter(({ estimate }) => estimate.length > 0);
  }

  /** What the Tasks started after `readAt` are expected to use of each window on `engineId`, in %. */
  expectedOf(engineId: EngineId, readAt: Date): Readonly<Record<UsageWindowName, number>> {
    const since = this.starts.filter(({ at }) => at > readAt);
    const windowsOf = (name: UsageWindowName): number =>
      since.reduce(
        (total, { estimate }) =>
          total + (estimate.find((usage) => usage.engineId === engineId)?.windows?.[name] ?? 0),
        0,
      );
    return { fiveHour: windowsOf("fiveHour"), sevenDay: windowsOf("sevenDay") };
  }
}
