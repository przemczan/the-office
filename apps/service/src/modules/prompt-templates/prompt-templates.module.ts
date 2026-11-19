import { Module } from "@nestjs/common";
import { PromptTemplatesController } from "./adapters/http/prompt-templates.controller.js";
import { PostgresPromptTemplateRepository } from "./adapters/postgres/postgres-prompt-template-repository.js";
import { PromptTemplateCatalog } from "./application/prompt-template-catalog.js";
import { PromptTemplates } from "./application/prompt-templates.js";
import { PromptTemplateRepository } from "./ports/prompt-template-repository.js";

/**
 * Prompt templates (spec §2.2, §5.3): the catalog the other modules register their templates in,
 * their saved versions and Settings › Prompts. It imports no other module, so every module that
 * owns a prompt can import it.
 */
@Module({
  controllers: [PromptTemplatesController],
  providers: [
    { provide: PromptTemplateRepository, useClass: PostgresPromptTemplateRepository },
    PromptTemplateCatalog,
    PromptTemplates,
  ],
  exports: [PromptTemplateCatalog, PromptTemplates],
})
export class PromptTemplatesModule {}
