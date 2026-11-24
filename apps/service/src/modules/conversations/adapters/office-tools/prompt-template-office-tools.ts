import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  PROMPT_TEMPLATE_MAX_CHARACTERS,
  PROPOSE_PROMPT_TEMPLATE_RESET_TOOL,
  PROPOSE_PROMPT_TEMPLATE_TOOL,
  promptTemplateDomainSchema,
} from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry, type OfficeToolResult } from "../../../engine/index.js";
import {
  PromptTemplateNotFound,
  PromptTemplates,
  type PromptTemplateState,
  type PromptVariable,
} from "../../../prompt-templates/index.js";
import { ProposalService } from "../../application/proposal-service.js";
import type { ProposedPromptTemplateChange } from "../../domain/proposal.js";
import {
  LIST_PROMPT_TEMPLATES_TOOL,
  READ_PROMPT_TEMPLATE_TOOL,
} from "../../domain/session-instructions.js";
import { refusedToTheAgent } from "./refused-to-the-agent.js";

const PROMPT_TEMPLATE_DRAFTED =
  "The Proposal is in this Thread as a card; the template changes only when the user applies it, for prompts rendered after that. Don't wait for it: tell the user what you propose and why, in a line or two.";

const ONLY_WHEN_ASKED = "Draft one only when the user asks you to change a prompt template.";

const keyInput = z
  .string()
  .describe(
    `The template's key, such as pipelines.resolve-brief, as ${LIST_PROMPT_TEMPLATES_TOOL} gives it.`,
  );

/**
 * The Office tools the Default person to talk to reads the prompt templates with and drafts a new
 * text for one, or its reset to the default, as a Proposal the user applies with a click (spec
 * §2.2). Drafting changes nothing, so sits behind no Hard switch: the user's click is the approval.
 */
@Injectable()
export class PromptTemplateOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly templates: PromptTemplates,
    private readonly proposals: ProposalService,
  ) {}

  onModuleInit(): void {
    this.registerList();
    this.registerRead();
    this.registerPropose();
    this.registerProposeReset();
  }

  private registerList(): void {
    this.registry.register({
      name: LIST_PROMPT_TEMPLATES_TOOL,
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
      description: `Reads a prompt template as it is now: what it is for, its text whole, its default when customised, the variables it may use and what is wrong with its saved text. Read it before drafting a change with ${PROPOSE_PROMPT_TEMPLATE_TOOL}, and start from the text it answers.`,
      input: z.object({ key: keyInput }),
      run: ({ key }) => this.readOr(key, (state) => ({ text: readText(state), isError: false })),
    });
  }

  private registerPropose(): void {
    this.registry.register({
      name: PROPOSE_PROMPT_TEMPLATE_TOOL,
      description: `Drafts a new text for a prompt template as a Proposal the user applies with a click. It shows in this Thread as a card and changes nothing until the user applies it. It returns at once. ${ONLY_WHEN_ASKED}`,
      input: z.object({
        key: keyInput,
        text: z
          .string()
          .describe(
            `The template's new text, given whole: it replaces all of it, not only the lines that change. Start from what ${READ_PROMPT_TEMPLATE_TOOL} answers. Use only the variables it lists, as {{variable}}, or {{#list}}…{{/list}} for a flag or a list; partials and changed delimiters are refused, and so is a text over ${PROMPT_TEMPLATE_MAX_CHARACTERS} characters.`,
          ),
      }),
      run: ({ key, text }, { sessionId }) =>
        this.readOr(key, (state) =>
          refusedToTheAgent(async () => {
            await this.proposals.draft(sessionId, proposedChange(state, text));
            return PROMPT_TEMPLATE_DRAFTED;
          }),
        ),
    });
  }

  private registerProposeReset(): void {
    this.registry.register({
      name: PROPOSE_PROMPT_TEMPLATE_RESET_TOOL,
      description: `Drafts a prompt template's reset to the default that ships with The Office, as a Proposal the user applies with a click. It shows in this Thread as a card and changes nothing until the user applies it. It returns at once. ${ONLY_WHEN_ASKED}`,
      input: z.object({ key: keyInput }),
      run: ({ key }, { sessionId }) =>
        this.readOr(key, (state) =>
          refusedToTheAgent(async () => {
            await this.proposals.draft(sessionId, proposedChange(state, null));
            return PROMPT_TEMPLATE_DRAFTED;
          }),
        ),
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

/** A Proposal of `to` as the template's text, or of its default when null, from its text now. */
function proposedChange(
  state: PromptTemplateState,
  to: string | null,
): ProposedPromptTemplateChange {
  const { key, name } = state.template;
  return { kind: "prompt-template", key, name, from: state.text, to };
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
