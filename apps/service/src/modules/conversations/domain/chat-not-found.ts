/** A chat with a Role nobody fills. */
export class ChatNotFound extends Error {
  constructor(readonly roleKey: string) {
    super(`There is no chat with "${roleKey}": nobody fills the Role.`);
    this.name = "ChatNotFound";
  }
}
