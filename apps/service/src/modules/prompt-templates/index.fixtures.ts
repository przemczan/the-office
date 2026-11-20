import { EventBus } from "../../platform/events/event-bus.js";
import { PromptTemplateCatalog } from "./application/prompt-template-catalog.js";
import { PromptTemplates } from "./application/prompt-templates.js";
import type { PromptTemplate } from "./domain/prompt-template.js";
import { versionAfter } from "./domain/prompt-template-version.js";
import { PromptTemplateRepositoryForTests } from "./ports/prompt-template-repository.fixtures.js";

export { PromptTemplateRepository } from "./ports/prompt-template-repository.js";
export { PromptTemplateRepositoryForTests } from "./ports/prompt-template-repository.fixtures.js";

/**
 * Prompt templates as the module runs them, over a catalog of only `templates` and versions kept in
 * memory, for another module's tests that read or change a template without the database. `saved`
 * texts are stored unchecked, as one an older release saved, with a variable removed since.
 */
export async function promptTemplatesFor(
  templates: readonly PromptTemplate[],
  saved: readonly { readonly key: string; readonly text: string }[] = [],
): Promise<PromptTemplates> {
  const catalog = new PromptTemplateCatalog();
  catalog.register(templates);
  const repository = new PromptTemplateRepositoryForTests();
  for (const { key, text } of saved) {
    await repository.update(key, (current) => versionAfter(current, text, ""), new Date(), {
      userId: "00000000-0000-4000-8000-0000000005e1",
      name: "Ann Lee",
    });
  }
  return new PromptTemplates(catalog, repository, new EventBus());
}
