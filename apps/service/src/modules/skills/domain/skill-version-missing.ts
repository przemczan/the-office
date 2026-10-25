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
