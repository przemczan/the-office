/**
 * Where a person's Avatar can come from besides an upload: an image Attachment, which the module
 * keeping Attachments reads for People. The bytes go straight to the Avatar's own image rules and
 * are never shown to an Agent.
 */
export interface AvatarSource {
  /**
   * The stored file's bytes, whole. Throws RoleRefused, in the UI's words, for an Attachment that
   * isn't there or has no file (a link).
   */
  contentOf(attachmentId: string): Promise<Uint8Array>;
}
