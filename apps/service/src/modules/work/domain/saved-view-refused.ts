/** A Saved view that breaks the rules, with every reason, in the UI's words. */
export class SavedViewRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "SavedViewRefused";
  }
}
