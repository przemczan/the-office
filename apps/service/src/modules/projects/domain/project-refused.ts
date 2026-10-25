/** A Project change that breaks the Project's rules, with every reason, in the UI's words. */
export class ProjectRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "ProjectRefused";
  }
}
