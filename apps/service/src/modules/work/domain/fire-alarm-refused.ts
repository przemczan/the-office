/** A sounding of the fire alarm that breaks its rules (spec §2.8), with every reason, in the UI's words. */
export class FireAlarmRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "FireAlarmRefused";
  }
}
