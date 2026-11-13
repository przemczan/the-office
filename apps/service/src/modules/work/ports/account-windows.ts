import type { EngineId } from "../../engine/index.js";
import type { AccountWindowsReading, UsedUpWindowReading } from "../domain/cap-waits.js";

/** The usage windows as the Engine last read them; the composition root binds it. */
export abstract class AccountWindows {
  /** The windows of the account `engineId` spends on; undefined before a reading, or without windows. */
  abstract of(engineId: EngineId): AccountWindowsReading | undefined;

  /**
   * The window of `engineId`'s account the engine refuses turns for while its reset is ahead;
   * undefined otherwise, and after a restart until a turn is refused again (spec §5.4).
   */
  abstract usedUpUntil(engineId: EngineId): UsedUpWindowReading | undefined;
}
