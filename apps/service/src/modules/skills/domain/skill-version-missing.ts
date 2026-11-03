/** The library doesn't have a version's files, or not as they were kept. */
export class SkillVersionMissing extends Error {
  constructor(
    readonly skillName: string,
    readonly filesHash: string,
    reason: string,
  ) {
    super(`The library doesn't have ${skillName} with the files ${filesHash}: ${reason}`);
    this.name = "SkillVersionMissing";
  }
}

/**
 * The library has no folder for a version's files at all: never kept, or removed. Unlike files
 * that changed, this is what a skill removed meanwhile leaves.
 */
export class SkillVersionNotKept extends SkillVersionMissing {
  constructor(skillName: string, filesHash: string) {
    super(skillName, filesHash, "they were never kept, or were removed.");
    this.name = "SkillVersionNotKept";
  }
}
