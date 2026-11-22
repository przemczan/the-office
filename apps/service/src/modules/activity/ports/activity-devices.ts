import type { ActivityDevice } from "../domain/activity.js";

/** The Connected devices, which Devices keeps; the composition root binds it. */
export abstract class ActivityDevices {
  /** Every device not Disconnected. */
  abstract open(): Promise<readonly ActivityDevice[]>;
}
