import type { SkillUse } from "../domain/skill-uses.js";

/** Where each Skill use is kept, while it counts. */
export abstract class SkillUseRepository {
  /**
   * Keeps the use; false when its library skill was removed meanwhile, which keeps no use.
   */
  abstract add(use: SkillUse): Promise<boolean>;

  /** Each library skill's uses after `since`, by its name; a skill with none is left out. */
  abstract libraryCounts(since: Date): Promise<ReadonlyMap<string, number>>;

  /** Each of the Project's skills' uses after `since`, by its key; a key with none is left out. */
  abstract projectCounts(projectId: string, since: Date): Promise<ReadonlyMap<string, number>>;

  /** Removes the uses at or before `until`. */
  abstract removeUntil(until: Date): Promise<void>;
}
