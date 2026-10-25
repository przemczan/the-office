/** A Thread change that breaks the rules, with every reason, in the UI's words. */
export class ThreadRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "ThreadRefused";
  }
}
