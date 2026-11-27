import { HttpException, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  CONVERSATIONS_SETTINGS_OFFICE_ACTIONS,
  SET_OFFICE_INSTRUCTIONS_ACTION,
  SET_SIZE_THRESHOLD_ACTION,
  SET_STAGE_CONTEXT_LIMITS_ACTION,
  type OfficeAction,
  type OfficeInstructions as OfficeInstructionsText,
  type SizeThreshold,
  type StageContextLimitsSetting,
} from "@the-office/contracts";
import type { z } from "zod";
import {
  officeActionDraft,
  officeActionTool,
  OfficeToolRegistry,
  type OfficeActionSubjectSnapshot,
  type OfficeToolResult,
  type OfficeToolUser,
} from "../../../engine/index.js";
import { ContextPolicySettingsService } from "../../application/context-policy-settings.js";
import { OfficeInstructions } from "../../application/office-instructions.js";
import { ThreadService } from "../../application/thread-service.js";

/**
 * One of Conversations' Office settings actions as Conversations carries it out: `handle` for the
 * user's request, an Agent's call and a Proposal applied alike, its result answered to the web by
 * `response` and worded to the Agent by `words`; `snapshot` is the setting as it is now, what a
 * draft shows and is fingerprinted by.
 */
interface ConversationsSettingHandler<Action extends OfficeAction, Result> {
  readonly action: Action;
  /** `by` names the user behind the call, asked for only by a setting that records one. */
  handle(input: z.output<Action["input"]>, by: () => Promise<OfficeToolUser>): Promise<Result>;
  response(result: Result): z.input<Action["answer"]>;
  words(result: Result): string;
  snapshot(): Promise<OfficeActionSubjectSnapshot>;
}

type AnyConversationsSettingHandler = ConversationsSettingHandler<OfficeAction, unknown>;

function handler<Action extends OfficeAction, Result>(
  each: ConversationsSettingHandler<Action, Result>,
): AnyConversationsSettingHandler {
  return each as unknown as AnyConversationsSettingHandler;
}

const NO_ASKING_USER = "The Office doesn't know which user asked for this.";

/**
 * Conversations' Office actions on Office settings (the Office action convention): the size
 * threshold, the Office instructions and the Stage context limits. The one handler of each action
 * declared in CONVERSATIONS_SETTINGS_OFFICE_ACTIONS, which its route
 * (`ConversationsSettingsOfficeActionsController`) and its Office tool, registered here, both call.
 * Throws at start for a declared action with no handler. The Office instructions record the user
 * behind a call, as a Proposal applied records its user: the one who allowed it, else the one who
 * asked. A draft fingerprints the setting as it is now, so a change since the draft means the
 * setting changed.
 */
@Injectable()
export class ConversationsSettingsOfficeActions implements OnModuleInit {
  private readonly handlers: ReadonlyMap<string, AnyConversationsSettingHandler>;

  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly contextPolicy: ContextPolicySettingsService,
    private readonly officeInstructions: OfficeInstructions,
    private readonly threads: ThreadService,
  ) {
    this.handlers = new Map(
      [this.sizeThreshold(), this.officeInstructionsText(), this.stageContextLimits()].map(
        (each) => [each.action.name, each],
      ),
    );
    const unhandled = CONVERSATIONS_SETTINGS_OFFICE_ACTIONS.filter(
      ({ name }) => !this.handlers.has(name),
    );
    if (unhandled.length > 0) {
      throw new Error(`No handler carries out ${unhandled.map(({ name }) => name).join(", ")}.`);
    }
  }

  onModuleInit(): void {
    for (const each of this.handlers.values()) {
      const run = (input: never, by: () => Promise<OfficeToolUser>): Promise<OfficeToolResult> =>
        answered(async () => each.words(await each.handle(input, by)));
      this.registry.register(
        officeActionTool(
          each.action,
          (input, { sessionId, allowedBy }) =>
            run(input as never, () => this.userBehind(sessionId, allowedBy)),
          {
            draft: async (input) => officeActionDraft(each.action, input, await each.snapshot()),
            applyFor: (input, { user }) => run(input as never, () => Promise.resolve(user)),
          },
        ),
      );
    }
  }

  /** The route's answer to the action, carried out for the signed-in user. */
  async answer(action: OfficeAction, input: unknown, by: OfficeToolUser): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`Conversations carries out no Office action ${action.name}.`);
    return each.response(await each.handle(input as never, () => Promise.resolve(by)));
  }

  private sizeThreshold(): AnyConversationsSettingHandler {
    return handler({
      action: SET_SIZE_THRESHOLD_ACTION,
      handle: async ({ sizeThreshold }: SizeThreshold): Promise<SizeThreshold> => {
        await this.contextPolicy.changeSizeThreshold(sizeThreshold);
        return { sizeThreshold };
      },
      response: (threshold: SizeThreshold) => threshold,
      words: ({ sizeThreshold }: SizeThreshold) => `The size threshold is ${sizeThreshold} tokens.`,
      snapshot: async () => {
        const now = { sizeThreshold: await this.contextPolicy.sizeThreshold() };
        return { title: "Size threshold", decidedBy: now, values: now };
      },
    });
  }

  private officeInstructionsText(): AnyConversationsSettingHandler {
    return handler({
      action: SET_OFFICE_INSTRUCTIONS_ACTION,
      handle: async (
        { officeInstructions }: OfficeInstructionsText,
        by,
      ): Promise<OfficeInstructionsText> => {
        const { text } = await this.officeInstructions.save(officeInstructions, await by());
        return { officeInstructions: text };
      },
      response: (instructions: OfficeInstructionsText) => instructions,
      words: ({ officeInstructions }: OfficeInstructionsText) =>
        officeInstructions === ""
          ? "The Office instructions are empty now."
          : "The Office instructions are saved; every session started from now on gets them.",
      snapshot: async () => {
        const { text } = await this.officeInstructions.current();
        const now = { officeInstructions: text };
        return { title: "Office instructions", decidedBy: now, values: now };
      },
    });
  }

  private stageContextLimits(): AnyConversationsSettingHandler {
    return handler({
      action: SET_STAGE_CONTEXT_LIMITS_ACTION,
      handle: async ({
        stageContextLimits,
      }: StageContextLimitsSetting): Promise<StageContextLimitsSetting> => {
        await this.contextPolicy.changeStageContextLimits(stageContextLimits);
        return { stageContextLimits };
      },
      response: (setting: StageContextLimitsSetting) => setting,
      words: () => "The Stage context limits are saved.",
      snapshot: async () => {
        const now = { stageContextLimits: await this.contextPolicy.stageContextLimits() };
        return { title: "Stage context limits", decidedBy: now, values: now };
      },
    });
  }

  /** The user a person's call is for: the one who allowed it, else the one who asked. */
  private async userBehind(
    sessionId: string,
    allowedBy: OfficeToolUser | undefined,
  ): Promise<OfficeToolUser> {
    if (allowedBy) return { userId: allowedBy.userId, name: allowedBy.name };
    const asked = await this.threads.askedByInSession(sessionId);
    if (!asked) throw new NoAskingUser();
    return { userId: asked.userId, name: asked.name };
  }
}

/** A call from a session whose Thread has no user's message to act for. */
class NoAskingUser extends HttpException {
  constructor() {
    super(NO_ASKING_USER, 409);
  }
}

/** A refusal answers the Agent in words it can act on; anything else fails the call. */
async function answered(read: () => Promise<string>): Promise<OfficeToolResult> {
  try {
    return { text: await read(), isError: false };
  } catch (error) {
    if (error instanceof HttpException) return { text: error.message, isError: true };
    throw error;
  }
}
