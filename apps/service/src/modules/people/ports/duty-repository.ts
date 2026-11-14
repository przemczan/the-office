import type { DutyAssignments, DutyKey } from "../domain/duties.js";

/** One duty set to a Role key, or to `null` for none. */
export interface DutyAssignment {
  readonly duty: DutyKey;
  readonly roleKey: string | null;
}

/** Where the duties the user set are kept; a duty never set is missing, at its default. */
export abstract class DutyRepository {
  abstract assignments(): Promise<DutyAssignments>;

  abstract assign(duty: DutyKey, roleKey: string | null, at: Date): Promise<void>;

  /** Saves every change or none of them. */
  abstract assignAll(changes: readonly DutyAssignment[], at: Date): Promise<void>;
}
