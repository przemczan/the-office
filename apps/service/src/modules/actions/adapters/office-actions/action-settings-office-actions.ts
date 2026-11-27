import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  ACTION_SETTINGS_OFFICE_ACTIONS,
  SET_ACTION_SETTINGS_ACTION,
  type ActionSettings,
  type OfficeAction,
} from "@the-office/contracts";
import type { z } from "zod";
import {
  officeActionDraft,
  officeActionTool,
  OfficeToolRegistry,
  type OfficeToolResult,
} from "../../../engine/index.js";
import { ActionLimits } from "../../application/action-limits.js";
import { ActionRunRefused } from "../../domain/action-run-refused.js";

/**
 * One of Actions' settings Office actions as Actions carries it out: `handle` for the user's
 * request, an Agent's call and a Proposal applied alike, its result answered to the web by
 * `response` and worded to the Agent by `words`.
 */
interface ActionSettingsHandler<Action extends OfficeAction, Result> {
  readonly action: Action;
  handle(input: z.output<Action["input"]>): Promise<Result>;
  response(result: Result): z.input<Action["answer"]>;
  words(result: Result): string;
}

type AnyActionSettingsHandler = ActionSettingsHandler<OfficeAction, unknown>;

function handler<Action extends OfficeAction, Result>(
  each: ActionSettingsHandler<Action, Result>,
): AnyActionSettingsHandler {
  return each as unknown as AnyActionSettingsHandler;
}

/**
 * Actions' Office actions on Office settings (the Office action convention): the one handler of
 * each action declared in ACTION_SETTINGS_OFFICE_ACTIONS, which its route
 * (`ActionSettingsOfficeActionsController`) and its Office tool, registered here, both call. Throws
 * at start for a declared action with no handler. The draft shows Actions at once beside the number
 * in force, which also fingerprints the change.
 */
@Injectable()
export class ActionSettingsOfficeActions implements OnModuleInit {
  private readonly handlers: ReadonlyMap<string, AnyActionSettingsHandler>;

  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly limits: ActionLimits,
  ) {
    this.handlers = new Map([this.setActionSettings()].map((each) => [each.action.name, each]));
    const unhandled = ACTION_SETTINGS_OFFICE_ACTIONS.filter(({ name }) => !this.handlers.has(name));
    if (unhandled.length > 0) {
      throw new Error(`No handler carries out ${unhandled.map(({ name }) => name).join(", ")}.`);
    }
  }

  onModuleInit(): void {
    for (const each of this.handlers.values()) {
      const run = (input: never): Promise<OfficeToolResult> =>
        answered(async () => each.words(await each.handle(input)));
      this.registry.register(
        officeActionTool(each.action, run, {
          draft: async (input) => {
            const now = await this.limits.read();
            return officeActionDraft(each.action, input, {
              title: "Actions at once",
              decidedBy: { ...now },
              values: { ...now },
            });
          },
          applyFor: run,
        }),
      );
    }
  }

  /** The route's answer to the action, carried out for the signed-in user. */
  async answer(action: OfficeAction, input: unknown): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`Actions carries out no Office action ${action.name}.`);
    return each.response(await each.handle(input as never));
  }

  private setActionSettings(): AnyActionSettingsHandler {
    return handler({
      action: SET_ACTION_SETTINGS_ACTION,
      handle: (settings: ActionSettings) => this.limits.change(settings),
      response: (settings: ActionSettings) => settings,
      words: ({ actionsAtOnce }: ActionSettings) =>
        `Action runs go ${actionsAtOnce} at once from now on.`,
    });
  }
}

/** Actions' refusals answer the Agent in words it can act on; anything else fails the call. */
async function answered(read: () => Promise<string>): Promise<OfficeToolResult> {
  try {
    return { text: await read(), isError: false };
  } catch (error) {
    if (error instanceof ActionRunRefused) return { text: error.message, isError: true };
    throw error;
  }
}
