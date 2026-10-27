import type { OfficeTask } from "../domain/now.js";

/** The Tasks, which Work keeps; the composition root binds it. */
export abstract class OfficeTasks {
  abstract list(): Promise<readonly OfficeTask[]>;
  /** The Tasks at a desk: In progress, Waiting on you or Paused. */
  abstract listStarted(): Promise<readonly OfficeTask[]>;
}
