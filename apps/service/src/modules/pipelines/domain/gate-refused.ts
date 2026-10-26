/** A Gate action the Task's Stages don't allow now, with every reason, in the UI's words. */
export class GateRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "GateRefused";
  }
}
