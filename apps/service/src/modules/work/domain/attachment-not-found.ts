export class AttachmentNotFound extends Error {
  constructor(readonly attachmentId: string) {
    super(`There is no Attachment "${attachmentId}".`);
    this.name = "AttachmentNotFound";
  }
}
