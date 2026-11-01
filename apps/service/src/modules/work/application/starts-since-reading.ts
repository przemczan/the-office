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

  record(at: Date, estimate: readonly EngineUsage[]): void {
    this.starts.push({ at, estimate });
  }

  /** A new reading shows what the Tasks started before it used. */
  forgetUntil(readAt: Date): void {
    this.starts = this.starts.filter(({ at }) => at > readAt);
  }

  /** What the Tasks started after `readAt` are expected to use of each window on `engineId`, in %. */
  expectedOf(engineId: EngineId, readAt: Date): Readonly<Record<UsageWindowName, number>> {
    const since = this.starts.filter(({ at }) => at > readAt);
    const windowsOf = (name: UsageWindowName): number =>
      since.reduce(
        (total, { estimate }) =>
          total + (estimate.find((usage) => usage.engineId === engineId)?.windows[name] ?? 0),
        0,
      );
    return { fiveHour: windowsOf("fiveHour"), sevenDay: windowsOf("sevenDay") };
  }
}
