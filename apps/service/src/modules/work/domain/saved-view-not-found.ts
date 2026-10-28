export class SavedViewNotFound extends Error {
  constructor(readonly savedViewId: string) {
    super(`There is no Saved view "${savedViewId}".`);
    this.name = "SavedViewNotFound";
  }
}
