import type { InitiativeTask, OfficeInitiative } from "../domain/now.js";

/** The Initiatives, which Work keeps; the composition root binds it. */
export abstract class OfficeInitiatives {
  /** Every Initiative, archived ones too. */
  abstract list(): Promise<readonly OfficeInitiative[]>;
  /** Every Initiative's Tasks, by the Initiative's id. */
  abstract tasksByInitiative(): Promise<ReadonlyMap<string, readonly InitiativeTask[]>>;
}
