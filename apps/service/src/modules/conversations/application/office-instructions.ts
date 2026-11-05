import { Injectable } from "@nestjs/common";
import { OfficeInstructionsVersionNotFound } from "../domain/office-instructions-version-not-found.js";
import {
  NO_OFFICE_INSTRUCTIONS,
  versionAfter,
  type OfficeInstructionsVersion,
} from "../domain/office-instructions.js";
import { OfficeInstructionsRepository } from "../ports/office-instructions-repository.js";

/**
 * The Office instructions for the session starts (spec §2.2): as with a Role card, a new session
 * gets the current version and records it; a resumed one is given the version it recorded, so a
 * change reaches only sessions started after it.
 */
@Injectable()
export class OfficeInstructions {
  constructor(private readonly repository: OfficeInstructionsRepository) {}

  /** Version 0 with no text until one is saved. */
  current(): Promise<OfficeInstructionsVersion> {
    return this.repository.current();
  }

  /** Version 0 is none; any other unsaved version throws OfficeInstructionsVersionNotFound. */
  async forResumedSession(version: number): Promise<OfficeInstructionsVersion> {
    if (version === NO_OFFICE_INSTRUCTIONS.version) return NO_OFFICE_INSTRUCTIONS;
    const saved = await this.repository.version(version);
    if (!saved) throw new OfficeInstructionsVersionNotFound(version);
    return saved;
  }

  /** The current text again makes no new version. Answers the current version. */
  save(text: string): Promise<OfficeInstructionsVersion> {
    return this.repository.update((current) => versionAfter(current, text), new Date());
  }
}
