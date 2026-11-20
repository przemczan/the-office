export class PromptTemplateNotFound extends Error {
  constructor(readonly key: string) {
    super(`The Office has no prompt template "${key}".`);
    this.name = "PromptTemplateNotFound";
  }
}
