import { Injectable } from "@nestjs/common";
import type { DutyAssignments, DutyKey } from "../domain/duties.js";
import { DutyRepository, type DutyAssignment } from "./duty-repository.js";

/**
 * The duties in memory, none set until a test sets one: every test file shares the stored ones,
 * which would change who every other file's sessions consult.
 */
@Injectable()
export class DutyRepositoryForTests extends DutyRepository {
  private stored: Partial<Record<DutyKey, string | null>> = {};
  /** How many times anything was saved. */
  saves = 0;

  assignments(): Promise<DutyAssignments> {
    return Promise.resolve({ ...this.stored });
  }

  assign(duty: DutyKey, roleKey: string | null): Promise<void> {
    return this.assignAll([{ duty, roleKey }]);
  }

  assignAll(changes: readonly DutyAssignment[]): Promise<void> {
    this.saves += 1;
    this.stored = {
      ...this.stored,
      ...Object.fromEntries(changes.map(({ duty, roleKey }) => [duty, roleKey])),
    };
    return Promise.resolve();
  }
}
