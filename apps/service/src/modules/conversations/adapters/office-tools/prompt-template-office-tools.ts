import { Injectable, type OnModuleInit } from "@nestjs/common";
import { promptTemplateDomainSchema } from "@the-office/contracts";
import { z } from "zod";
import { CORE_AREA, OfficeToolRegistry, type OfficeToolResult } from "../../../engine/index.js";
import {
  PromptTemplateNotFound,
  PromptTemplates,
  type PromptTemplateState,
  type PromptVariable,
} from "../../../prompt-templates/index.js";
import {
  LIST_PROMPT_TEMPLATES_TOOL,
  READ_PROMPT_TEMPLATE_TOOL,
} from "../../domain/session-instructions.js";

const keyInput = z
  .string()
  .describe(
    `The template's key, such as pipelines.resolve-brief, as ${LIST_PROMPT_TEMPLATES_TOOL} gives it.`,
  );

/**
 * The Office tools the prompt templates are read with (spec §2.2); a new text or a reset is the
 * Office actions `save_prompt_template` and `reset_prompt_template`, ruled by the person's Authority.
 */
@Injectable()
export class PromptTemplateOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly templates: PromptTemplates,
  ) {}

  onModuleInit(): void {
    this.registerList();
    this.registerRead();
  }

  private registerList(): void {
    this.registry.register({
      name: LIST_PROMPT_TEMPLATES_TOOL,
      area: CORE_AREA,
      description:
        "Lists the prompt templates, the texts The Office gives Agents and sessions, each with its key, name, domain, what it is for and whether it is customised or its default.",
      input: z.object({
        domain: promptTemplateDomainSchema
          .optional()
          .describe(
            "Only the templates of this domain, the Settings tab they sit in; all when left out.",
          ),
      }),
      run: async ({ domain }) => {
        const states = await this.templates.list(domain);
        if (states.length === 0) return { text: "There are no prompt templates.", isError: false };
        return { text: states.map(listLine).join("\n"), isError: false };
      },
    });
  }

  private registerRead(): void {
    this.registry.register({
      name: READ_PROMPT_TEMPLATE_TOOL,
      area: CORE_AREA,
      description: `Reads a prompt template as it is now: what it is for, its text whole, its default when customised, the variables it may use and what is wrong with its saved text. Read it before save_prompt_template, and start from the text it answers: a save replaces the text whole, using only the variables listed here as {{variable}} (or {{#list}}…{{/list}} for a flag or a list; partials and changed delimiters are refused).`,
      input: z.object({ key: keyInput }),
      run: ({ key }) => this.readOr(key, (state) => ({ text: readText(state), isError: false })),
    });
  }

  /** Answers with what `answer` makes of the template, or that The Office has none by that key. */
  private async readOr(
    key: string,
    answer: (state: PromptTemplateState) => OfficeToolResult | Promise<OfficeToolResult>,
  ): Promise<OfficeToolResult> {
    try {
      return await answer(await this.templates.read(key.trim()));
    } catch (error) {
      if (error instanceof PromptTemplateNotFound) return { text: error.message, isError: true };
      throw error;
    }
  }
}

function listLine(state: PromptTemplateState): string {
  const { key, name, domain, description } = state.template;
  return `- ${key} (${domain}): ${name}. ${description} ${customisedLabel(state)}.`;
}

/** "customised, version N, by ‹user› on ‹date›", or "default". */
function customisedLabel({ customised, saved }: PromptTemplateState): string {
  if (!customised || !saved) return "Default";
  const on = saved.savedAt.toISOString().slice(0, 10);
  return `Customised, version ${saved.version}, by ${saved.savedBy.name} on ${on}`;
}

function readText(state: PromptTemplateState): string {
  const { key, name, description, text: defaultText, variables } = state.template;
  const sections = [
    `${name} (${key}): ${description}`,
    `${customisedLabel(state)}.`,
    `Text now:\n${state.text}`,
    ...(state.customised ? [`Default:\n${defaultText}`] : []),
    `Variables:\n${variableLines(variables)}`,
    ...(state.problems.length > 0
      ? [
          `Problems with the saved text, so the default renders instead:\n${state.problems
            .map(({ line, column, message }) => `- Line ${line}, column ${column}: ${message}`)
            .join("\n")}`,
        ]
      : []),
  ];
  return sections.join("\n\n");
}

function variableLines(variables: Readonly<Record<string, PromptVariable>>): string {
  const entries = Object.entries(variables);
  if (entries.length === 0) return "None.";
  return entries
    .flatMap(([name, variable]) => [
      `- ${name} (${variable.kind}): ${variable.description}`,
      ...(variable.kind === "list" && variable.fields
        ? Object.entries(variable.fields).map(([field, about]) => `  - ${field}: ${about}`)
        : []),
    ])
    .join("\n");
}
