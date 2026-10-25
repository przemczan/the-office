export class IdeaNotFound extends Error {
  constructor(readonly ideaId: string) {
    super(`There is no Idea "${ideaId}".`);
    this.name = "IdeaNotFound";
  }
}
