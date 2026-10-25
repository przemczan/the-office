/** A skill change that breaks the library's rules, with every reason, in the UI's words. */
export class SkillRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "SkillRefused";
  }
}
