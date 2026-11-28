/** A read of a Thread's log named a message that isn't in it. */
export class MessageNotFound extends Error {
  constructor(
    readonly threadId: string,
    readonly messageId: string,
  ) {
    super(`There is no message "${messageId}" in Thread "${threadId}".`);
    this.name = "MessageNotFound";
  }
}
