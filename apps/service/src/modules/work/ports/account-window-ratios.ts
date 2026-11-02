import type { EngineId } from "../../engine/index.js";
import type { WindowRatios } from "../domain/usage-estimate.js";

/**
 * What the account's windows move by per counted token, Office-wide, as the Engine learns it from
 * successive readings (spec §5.4); the composition root binds it.
 */
export abstract class AccountWindowRatios {
  /** The account `engineId` spends on's; each window undefined until a pair of readings gives it. */
  abstract ratios(engineId: EngineId): Promise<WindowRatios>;
}
