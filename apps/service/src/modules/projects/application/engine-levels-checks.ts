import { Injectable } from "@nestjs/common";
import type { ProjectEngineLevels } from "../domain/project.js";

/** A save of a Project's engine levels: the levels it holds and those the save would leave. */
export interface EngineLevelsSave {
  readonly projectId: string;
  readonly projectName: string;
  readonly before: ProjectEngineLevels;
  readonly after: ProjectEngineLevels;
}

/** What makes a save refused, in the UI's words; none lets it through. */
export type EngineLevelsCheck = (save: EngineLevelsSave) => Promise<readonly string[]>;

/**
 * The checks a save of a Project's engine levels passes, filled by People as it starts: People
 * resolves the engine cascade through Projects, so Projects can't ask People directly (the
 * module template's registry). With none registered, every save passes.
 */
@Injectable()
export class EngineLevelsChecks {
  private readonly checks: EngineLevelsCheck[] = [];

  register(check: EngineLevelsCheck): void {
    this.checks.push(check);
  }

  async problemsOf(save: EngineLevelsSave): Promise<readonly string[]> {
    const problems = await Promise.all(this.checks.map((check) => check(save)));
    return problems.flat();
  }
}
