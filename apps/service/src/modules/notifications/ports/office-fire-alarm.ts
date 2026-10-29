import type { NowFireAlarm } from "../domain/now.js";

/** The fire alarm, which Work keeps; the composition root binds it. */
export abstract class OfficeFireAlarm {
  abstract read(): Promise<NowFireAlarm>;
}
