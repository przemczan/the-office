import type { EngineId } from "../../engine/index.js";
import type { AccountWindowsReading } from "../domain/cap-waits.js";

/** The usage windows as the Engine last read them; the composition root binds it. */
export abstract class AccountWindows {
  /** The windows of the account `engineId` spends on; undefined before a reading, or without windows. */
  abstract of(engineId: EngineId): AccountWindowsReading | undefined;
}
