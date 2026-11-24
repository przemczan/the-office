/** A Restart from… or a Start over the Task doesn't allow now, with every reason, in the UI's words. */
export class RestartRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "RestartRefused";
  }
}
