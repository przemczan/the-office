import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PromptTemplateCatalog } from "../../../prompt-templates/index.js";
import { PIPELINES_PROMPT_TEMPLATES } from "../../domain/pipelines-prompt-templates.js";

/** Adds Pipelines' Prompt templates to the catalog, so Settings › Prompts lists them. */
@Injectable()
export class PipelinesPromptTemplates implements OnModuleInit {
  constructor(private readonly catalog: PromptTemplateCatalog) {}

  onModuleInit(): void {
    this.catalog.register(PIPELINES_PROMPT_TEMPLATES);
  }
}
