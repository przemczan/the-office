import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  PROMPT_TEMPLATES_OFFICE_ACTIONS,
  RESET_PROMPT_TEMPLATE_ACTION,
  SAVE_PROMPT_TEMPLATE_ACTION,
  promptTemplateSchema,
  type OfficeAction,
  type PromptTemplate as PromptTemplateBody,
} from "@the-office/contracts";
import type { z } from "zod";
import {
  officeActionDraft,
  officeActionTool,
  OfficeToolRegistry,
  type OfficeToolResult,
  type OfficeToolUser,
} from "../../../engine/index.js";
import {
  PromptTemplateNotFound,
  PromptTemplateRefused,
  PromptTemplates,
  type PromptTemplateState,
} from "../../../prompt-templates/index.js";
import { SessionPeople } from "../../ports/session-people.js";

type SavePromptTemplate = z.output<typeof SAVE_PROMPT_TEMPLATE_ACTION.input>;
type ResetPromptTemplate = z.output<typeof RESET_PROMPT_TEMPLATE_ACTION.input>;

/** The user a change is recorded for: their id and their name. */
interface ChangingUser {
  readonly userId: string;
  readonly name: string;
}

/**
 * The Prompt templates' Office actions (the Office action convention): `save_prompt_template` and
 * `reset_prompt_template`, which the route (`PromptTemplateOfficeActionsController`) and the Office
 * tool registered here both call. Pipelines carries them out rather than Prompt templates, which
 * Engine imports for its own templates and so can't import Engine's registry back. A person's
 * call records the user behind them, as a Proposal applied records its user: the one who allowed
 * it, else the one who asked. The draft shows the text as a diff and fingerprints the template's
 * newest saved version, so a save made since the draft means the template changed. Throws at start
 * for a declared action with no handler.
 */
@Injectable()
export class PromptTemplateOfficeActions implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly templates: PromptTemplates,
    private readonly sessionPeople: SessionPeople,
  ) {}

  onModuleInit(): void {
    for (const action of PROMPT_TEMPLATES_OFFICE_ACTIONS) {
      if (
        ![SAVE_PROMPT_TEMPLATE_ACTION.name, RESET_PROMPT_TEMPLATE_ACTION.name].includes(action.name)
      ) {
        throw new Error(`Prompt templates carries out no Office action ${action.name}.`);
      }
      this.register(action);
    }
  }

  private register(action: (typeof PROMPT_TEMPLATES_OFFICE_ACTIONS)[number]): void {
    const isSave = action.name === SAVE_PROMPT_TEMPLATE_ACTION.name;
    const run = async (input: Record<string, unknown>, by: () => Promise<ChangingUser>) =>
      answered(async () => {
        await this.carryOut(action, input, await by());
        return isSave ? "The Prompt template is saved." : "The Prompt template is reset.";
      });
    this.registry.register(
      officeActionTool(
        action,
        (input, { sessionId, allowedBy }) =>
          run(input, () => this.userBehind(sessionId, allowedBy)),
        {
          draft: (input) => this.draftOf(action, input),
          applyFor: (input, { user }) => run(input, () => Promise.resolve(user)),
        },
      ),
    );
  }

  /** The route's answer to the action, carried out for the signed-in user. */
  async answer(action: OfficeAction, input: unknown, by: ChangingUser): Promise<unknown> {
    if (!PROMPT_TEMPLATES_OFFICE_ACTIONS.some(({ name }) => name === action.name)) {
      throw new Error(`Prompt templates carries out no Office action ${action.name}.`);
    }
    return promptTemplateBody(await this.carryOut(action, input, by));
  }

  private carryOut(action: OfficeAction, input: unknown, by: ChangingUser) {
    if (action.name === SAVE_PROMPT_TEMPLATE_ACTION.name) {
      const { key, text } = input as SavePromptTemplate;
      return this.templates.save(key, text, by);
    }
    return this.templates.resetToDefault((input as ResetPromptTemplate).key, by);
  }

  /** The template as it is now: its text, and its newest saved version as what the call decides by. */
  private async draftOf(action: OfficeAction, input: Record<string, unknown>) {
    const state = await this.templates.read(String(input.key));
    const draft = officeActionDraft(action, input as never, {
      title: state.template.name,
      decidedBy: { version: state.saved?.version ?? 0, customised: state.customised },
      values: { text: state.text },
    });
    if (action.name !== RESET_PROMPT_TEMPLATE_ACTION.name) return draft;
    const after = state.template.text;
    return {
      ...draft,
      fields: [
        {
          label: "Text",
          before: state.text,
          after,
          form: after.includes("\n") || after.length > 80 ? ("long" as const) : ("short" as const),
        },
      ],
    };
  }

  /** The user a person's call is for: the one who allowed it, else the one who asked. */
  private async userBehind(
    sessionId: string,
    allowedBy: OfficeToolUser | undefined,
  ): Promise<ChangingUser> {
    if (allowedBy) return { userId: allowedBy.userId, name: allowedBy.name };
    const asked = await this.sessionPeople.askedByInSession(sessionId);
    if (!asked) {
      throw new PromptTemplateRefused(["The Office doesn't know which user asked for this."]);
    }
    return { userId: asked.userId, name: asked.name };
  }
}

/** The template's own refusals answer the Agent in words it can act on; anything else fails the call. */
async function answered(run: () => Promise<string>): Promise<OfficeToolResult> {
  try {
    return { text: await run(), isError: false };
  } catch (error) {
    if (error instanceof PromptTemplateRefused || error instanceof PromptTemplateNotFound) {
      return { text: error.message, isError: true };
    }
    throw error;
  }
}

/** The template as the web reads it. */
export function promptTemplateBody({
  template,
  saved,
  customised,
  problems,
  text,
}: PromptTemplateState): PromptTemplateBody {
  return promptTemplateSchema.parse({
    key: template.key,
    domain: template.domain,
    name: template.name,
    description: template.description,
    customised,
    hasProblems: problems.length > 0,
    version: saved?.version ?? 0,
    savedAt: saved?.savedAt.toISOString() ?? null,
    savedBy: saved?.savedBy ?? null,
    text,
    defaultText: template.text,
    variables: Object.entries(template.variables).map(([name, variable]) => ({
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
    problems: [...problems],
  });
}
