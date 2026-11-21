import type { OfficeTask } from "../domain/now.js";

/** The Tasks, which Work keeps; the composition root binds it. */
export abstract class OfficeTasks {
  /** The Tasks of these ids that Work knows, archived ones too, in no particular order. */
  abstract findAll(ids: readonly string[]): Promise<readonly OfficeTask[]>;
  /** The Tasks at a desk: In progress, Waiting on you or Paused, in the board's order. */
  abstract started(): Promise<readonly OfficeTask[]>;
  /** The Role whose person works the Task, from Start on. */
  abstract read(taskId: string): Promise<{ readonly personRole: string | undefined }>;
}
