/** The installed Skills whose daily check found an update; the composition root binds it. */
export abstract class SkillUpdatesFound {
  /** Their names. */
  abstract withUpdate(): Promise<readonly string[]>;
}
