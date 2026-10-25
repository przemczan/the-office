/** A Task change that breaks the rules, with every reason, in the UI's words. */
export class TaskRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "TaskRefused";
  }
}
