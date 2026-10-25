/** An Attachment that breaks the rules, with every reason, in the UI's words. */
export class AttachmentRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "AttachmentRefused";
  }
}
