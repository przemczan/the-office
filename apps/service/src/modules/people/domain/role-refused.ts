/** A hire or a Role card change that breaks the rules, with every reason, in the UI's words. */
export class RoleRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "RoleRefused";
  }
}
