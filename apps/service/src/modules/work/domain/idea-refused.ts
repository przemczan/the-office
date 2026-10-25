/** An Idea change that breaks the rules, with every reason, in the UI's words. */
export class IdeaRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "IdeaRefused";
  }
}
