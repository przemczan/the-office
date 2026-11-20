import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PromptTemplateCatalog } from "../../../prompt-templates/index.js";
import { WORK_PROMPT_TEMPLATES } from "../../domain/work-prompt-templates.js";

/** Adds Work's Prompt templates to the catalog, so Settings › Prompts lists them. */
@Injectable()
export class WorkPromptTemplates implements OnModuleInit {
  constructor(private readonly catalog: PromptTemplateCatalog) {}

  onModuleInit(): void {
    this.catalog.register(WORK_PROMPT_TEMPLATES);
  }
}
