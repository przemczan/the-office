import {
  NO_OFFICE_INSTRUCTIONS,
  type OfficeInstructionsVersion,
} from "../domain/office-instructions.js";
import { OfficeInstructionsRepository } from "./office-instructions-repository.js";

/**
 * Versions of the test's own: every test file shares the database, whose table each session start
 * would read.
 */
export class OfficeInstructionsRepositoryForTests extends OfficeInstructionsRepository {
  private readonly versions: OfficeInstructionsVersion[] = [];

  async current(): Promise<OfficeInstructionsVersion> {
    return this.versions.at(-1) ?? NO_OFFICE_INSTRUCTIONS;
  }

  async version(version: number): Promise<OfficeInstructionsVersion | undefined> {
    return this.versions.find((saved) => saved.version === version);
  }

  async update(
    change: (current: OfficeInstructionsVersion) => OfficeInstructionsVersion | undefined,
  ): Promise<OfficeInstructionsVersion> {
    const current = await this.current();
    const changed = change(current);
    if (!changed) return current;
    this.versions.push(changed);
    return changed;
  }
}
