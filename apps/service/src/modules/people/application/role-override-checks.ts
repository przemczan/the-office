import { Injectable } from "@nestjs/common";
import type { EngineModel } from "../../engine/index.js";

/** A save of a Role's card as it touches the Role override: the override before and after it. */
export interface RoleOverrideSave {
  readonly roleKey: string;
  readonly before: EngineModel | null;
  readonly after: EngineModel | null;
}

/** What makes a save refused, in the UI's words; none lets it through. */
export type RoleOverrideCheck = (save: RoleOverrideSave) => Promise<readonly string[]>;

/**
 * The checks a save of a Role override passes, filled by the engine cascade's module as it starts:
 * that module reads Role cards, and its check weighs every Project, so `RoleService` can't ask it
 * directly (the module template's registry). With none registered, every save passes.
 */
@Injectable()
export class RoleOverrideChecks {
  private readonly checks: RoleOverrideCheck[] = [];

  register(check: RoleOverrideCheck): void {
    this.checks.push(check);
  }

  async problemsOf(save: RoleOverrideSave): Promise<readonly string[]> {
    const problems = await Promise.all(this.checks.map((check) => check(save)));
    return problems.flat();
  }
}
