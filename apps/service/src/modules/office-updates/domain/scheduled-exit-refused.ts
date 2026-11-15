/**
 * An Office update or restart that can't be scheduled or cancelled now, with the reason, in the
 * UI's words.
 */
export class ScheduledExitRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "ScheduledExitRefused";
  }
}
