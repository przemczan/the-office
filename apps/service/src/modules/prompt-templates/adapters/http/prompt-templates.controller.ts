import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseFilters,
} from "@nestjs/common";
import {
  promptTemplateTextSchema,
  promptTemplatesQuerySchema,
  type PromptTemplate as PromptTemplateBody,
  type PromptTemplateCheck,
  type PromptTemplateSummary,
  type PromptTemplateText,
  type PromptTemplatesQuery,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { PromptTemplates } from "../../application/prompt-templates.js";
import type { PromptTemplateState } from "../../domain/prompt-template-state.js";
import { PromptTemplateRefusalsFilter } from "./prompt-template-refusals.filter.js";

/**
 * Settings › Prompt templates: each template read and its text checked; saving a text and
 * resetting to the default are Office actions (`PromptTemplateOfficeActions`, Pipelines').
 */
@Controller("settings/prompt-templates")
@UseFilters(PromptTemplateRefusalsFilter)
export class PromptTemplatesController {
  constructor(private readonly templates: PromptTemplates) {}

  @Get()
  async list(
    @Query(new ContractPipe(promptTemplatesQuerySchema)) { domain }: PromptTemplatesQuery,
  ): Promise<PromptTemplateSummary[]> {
    return (await this.templates.list(domain)).map(summaryOf);
  }

  @Get(":key")
  async read(@Param("key") key: string): Promise<PromptTemplateBody> {
    return bodyOf(await this.templates.read(key));
  }

  @Post(":key/check")
  @HttpCode(HttpStatus.OK)
  check(
    @Param("key") key: string,
    @Body(new ContractPipe(promptTemplateTextSchema)) { text }: PromptTemplateText,
  ): PromptTemplateCheck {
    return { problems: this.templates.check(key, text) };
  }
}

function summaryOf({
  template,
  saved,
  customised,
  problems,
}: PromptTemplateState): PromptTemplateSummary {
  return {
    key: template.key,
    domain: template.domain,
    name: template.name,
    description: template.description,
    customised,
    hasProblems: problems.length > 0,
    version: saved?.version ?? 0,
    savedAt: saved?.savedAt.toISOString() ?? null,
    savedBy: saved?.savedBy ?? null,
  };
}

function bodyOf(state: PromptTemplateState): PromptTemplateBody {
  return {
    ...summaryOf(state),
    text: state.text,
    defaultText: state.template.text,
    variables: Object.entries(state.template.variables).map(([name, variable]) => ({
      name,
      description: variable.description,
      kind: variable.kind,
      ...(variable.kind === "list" &&
        variable.fields !== undefined && {
          fields: Object.entries(variable.fields).map(([field, description]) => ({
            name: field,
            description,
          })),
        }),
    })),
    problems: [...state.problems],
  };
}
