import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Skill } from "../domain/skill.js";
import type { SkillChange } from "../domain/skill-changes.js";
import type { SkillVersion } from "../domain/skill-version.js";

/** The skill after an update, with the change's event, or undefined when nothing changed. */
export interface SkillUpdate<Event extends DomainEvent> {
  readonly skill: Skill;
  readonly event: Event | undefined;
}

/** Where the library's records are kept: each skill, and every version it has had. */
export abstract class SkillRepository {
  /** Keeps its current version too. Throws SkillRefused when the library has the name. */
  abstract add(skill: Skill): Promise<void>;

  abstract find(name: string): Promise<Skill | undefined>;

  /** Every skill, in the order they were added. */
  abstract list(): Promise<readonly Skill[]>;

  /** The skill's versions, oldest first; none when the library has no such skill. */
  abstract versions(name: string): Promise<readonly SkillVersion[]>;

  /**
   * Applies `change` to the skill as stored, holding it against other changes until the result
   * is saved, so two changes at once never lose one; a new version is kept with it. Saves nothing
   * when `change` returns undefined; throws SkillNotFound when there is no such skill.
   */
  abstract update<Event extends DomainEvent>(
    name: string,
    change: (skill: Skill) => SkillChange<Event> | undefined,
  ): Promise<SkillUpdate<Event>>;

  /**
   * Forgets the skill and its versions, and returns it as it was. Throws SkillNotFound when there
   * is no such skill.
   */
  abstract remove(name: string): Promise<Skill>;
}
