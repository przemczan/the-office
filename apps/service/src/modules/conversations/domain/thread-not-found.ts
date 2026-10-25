export class ThreadNotFound extends Error {
  constructor(readonly threadId: string) {
    super(`There is no Thread "${threadId}".`);
    this.name = "ThreadNotFound";
  }
}
