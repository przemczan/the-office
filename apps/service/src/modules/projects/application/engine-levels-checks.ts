import { Injectable } from "@nestjs/common";
import type { ProjectEngine } from "../domain/project.js";

/**
 * A save of a Project's engine levels that changes its default: the levels it holds and those the
 * save would leave. A save of only the force or the people names no engine, so it isn't weighed
 * (spec §5.4.5, "Roles that need Office tools and a held answer").
 */
export interface EngineLevelsSave {
  readonly projectId: string;
  readonly projectName: string;
  readonly before: ProjectEngine;
  readonly after: ProjectEngine;
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
