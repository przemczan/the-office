import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PromptTemplateCatalog } from "../../../prompt-templates/index.js";
import { ENGINE_PROMPT_TEMPLATES } from "../../domain/engine-prompt-templates.js";

/** Adds the Engine module's Prompt templates to the catalog, so Settings › Prompts lists them. */
@Injectable()
export class EnginePromptTemplates implements OnModuleInit {
  constructor(private readonly catalog: PromptTemplateCatalog) {}

  onModuleInit(): void {
    this.catalog.register(ENGINE_PROMPT_TEMPLATES);
  }
}
