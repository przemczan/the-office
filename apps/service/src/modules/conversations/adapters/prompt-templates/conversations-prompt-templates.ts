import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PromptTemplateCatalog } from "../../../prompt-templates/index.js";
import { CONVERSATIONS_PROMPT_TEMPLATES } from "../../domain/conversations-prompt-templates.js";

/** Adds Conversations' Prompt templates to the catalog, so Settings › Prompts lists them. */
@Injectable()
export class ConversationsPromptTemplates implements OnModuleInit {
  constructor(private readonly catalog: PromptTemplateCatalog) {}

  onModuleInit(): void {
    this.catalog.register(CONVERSATIONS_PROMPT_TEMPLATES);
  }
}
