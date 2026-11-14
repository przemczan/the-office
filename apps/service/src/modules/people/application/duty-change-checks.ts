import { Injectable } from "@nestjs/common";
import type { DutyKey } from "../domain/duties.js";

/** A duty about to name another Role, or none: the Role keys it names before and after. */
export interface DutyHolderSave {
  readonly duty: DutyKey;
  readonly from: string | null;
  readonly to: string | null;
}

/** What makes a duty change refused, in the UI's words; none lets it through. */
export type DutyChangeCheck = (save: DutyHolderSave) => Promise<readonly string[]>;

/**
 * The checks every duty change passes before it is saved, filled by other modules as they start
 * (the module template's registry), such as the engine check on the new holder (spec §5.4). With
 * none registered, every change the duty rules allow passes.
 */
@Injectable()
export class DutyChangeChecks {
  private readonly checks: DutyChangeCheck[] = [];

  register(check: DutyChangeCheck): void {
    this.checks.push(check);
  }

  async problemsOf(save: DutyHolderSave): Promise<readonly string[]> {
    const problems = await Promise.all(this.checks.map((check) => check(save)));
    return problems.flat();
  }
}
