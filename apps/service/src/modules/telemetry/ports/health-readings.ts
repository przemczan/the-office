import type { HealthHour } from "../domain/system-health.js";

/** The Office's own Health readings (spec 5.2, System health); the composition root binds it. */
export abstract class HealthReadings {
  /** The last hour of readings, oldest first, with its totals and slowest tables. */
  abstract lastHour(): HealthHour;
}
