/** A duty change that breaks the rules or came too late, with every reason, in the UI's words. */
export class DutyRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "DutyRefused";
  }
}

/** No duty has the key asked for. */
export class DutyNotFound extends Error {
  constructor(readonly duty: string) {
    super(`The Office has no duty "${duty}".`);
    this.name = "DutyNotFound";
  }
}
