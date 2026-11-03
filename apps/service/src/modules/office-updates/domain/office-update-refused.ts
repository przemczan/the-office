/** An Office update that can't be scheduled or cancelled now, with the reason, in the UI's words. */
export class OfficeUpdateRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "OfficeUpdateRefused";
  }
}
