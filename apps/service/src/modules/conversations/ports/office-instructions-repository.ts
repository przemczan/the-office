import type { OfficeInstructionsVersion } from "../domain/office-instructions.js";

/** Every version of the Office instructions, kept for the sessions that started with it. */
export abstract class OfficeInstructionsRepository {
  /** The newest version; `NO_OFFICE_INSTRUCTIONS` until one is saved. */
  abstract current(): Promise<OfficeInstructionsVersion>;

  abstract version(version: number): Promise<OfficeInstructionsVersion | undefined>;

  /**
   * Saves the version `change` makes of the current one, with no other save between the two, and
   * answers it; `change` returning undefined saves nothing and answers the current one.
   */
  abstract update(
    change: (current: OfficeInstructionsVersion) => OfficeInstructionsVersion | undefined,
    savedAt: Date,
  ): Promise<OfficeInstructionsVersion>;
}
