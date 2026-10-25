export class SkillNotFound extends Error {
  constructor(readonly skillName: string) {
    super(`The library has no skill "${skillName}".`);
    this.name = "SkillNotFound";
  }
}
