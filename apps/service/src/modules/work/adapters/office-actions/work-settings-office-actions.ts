import { BadRequestException, HttpException, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  SET_ARCHIVE_PERIOD_ACTION,
  SET_OFFICE_WIDE_LIMIT_ACTION,
  SET_USAGE_SETTINGS_ACTION,
  WORK_SETTINGS_OFFICE_ACTIONS,
  type ArchivePeriod,
  type OfficeAction,
  type OfficeWideLimit,
  type UsageSettings as UsageSettingsRequest,
} from "@the-office/contracts";
import type { z } from "zod";
import {
  officeActionDraft,
  officeActionTool,
  OfficeToolRegistry,
  type OfficeActionSubjectSnapshot,
  type OfficeToolResult,
} from "../../../engine/index.js";
import { OfficeLimits } from "../../application/office-limits.js";
import type { UsageSettings } from "../../domain/usage-settings.js";
import { toUsageSettingsResponse } from "../http/work-responses.js";

/**
 * One of Work's Office settings actions as Work carries it out: `handle` for the user's request, an
 * Agent's call and a Proposal applied alike, its result answered to the web by `response` and
 * worded to the Agent by `words`; `snapshot` is the setting as it is now, what a draft shows and
 * is fingerprinted by.
 */
interface OfficeSettingsHandler<Action extends OfficeAction, Result> {
  readonly action: Action;
  handle(input: z.output<Action["input"]>): Promise<Result>;
  response(result: Result): z.input<Action["answer"]>;
  words(result: Result): string;
  snapshot(): Promise<OfficeActionSubjectSnapshot>;
}

type AnyOfficeSettingsHandler = OfficeSettingsHandler<OfficeAction, unknown>;

function handler<Action extends OfficeAction, Result>(
  each: OfficeSettingsHandler<Action, Result>,
): AnyOfficeSettingsHandler {
  return each as unknown as AnyOfficeSettingsHandler;
}

/**
 * Work's Office actions on Office settings (the Office action convention): the Office-wide limit,
 * the Archive period and Usage. The one handler of each action declared in
 * WORK_SETTINGS_OFFICE_ACTIONS, which its route (`WorkSettingsOfficeActionsController`) and its
 * Office tool, registered here, both call. Throws at start for a declared action with no handler.
 * A setting names no user, so a person's call records none. The draft shows each value given beside
 * the one in force, which also fingerprints the change.
 */
@Injectable()
export class WorkSettingsOfficeActions implements OnModuleInit {
  private readonly handlers: ReadonlyMap<string, AnyOfficeSettingsHandler>;

  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly limits: OfficeLimits,
  ) {
    this.handlers = new Map(
      [this.officeWideLimit(), this.archivePeriod(), this.usage()].map((each) => [
        each.action.name,
        each,
      ]),
    );
    const unhandled = WORK_SETTINGS_OFFICE_ACTIONS.filter(({ name }) => !this.handlers.has(name));
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
          draft: async (input) => officeActionDraft(each.action, input, await each.snapshot()),
          applyFor: run,
        }),
      );
    }
  }

  /** The route's answer to the action, carried out for the signed-in user. */
  async answer(action: OfficeAction, input: unknown): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`Work carries out no Office action ${action.name}.`);
    return each.response(await each.handle(input as never));
  }

  private officeWideLimit(): AnyOfficeSettingsHandler {
    return handler({
      action: SET_OFFICE_WIDE_LIMIT_ACTION,
      handle: async ({ officeWideLimit }: OfficeWideLimit): Promise<OfficeWideLimit> => {
        await this.limits.changeOfficeWideLimit(officeWideLimit);
        return { officeWideLimit };
      },
      response: (limit: OfficeWideLimit) => limit,
      words: ({ officeWideLimit }: OfficeWideLimit) =>
        `The Office-wide limit is ${officeWideLimit} Tasks running at once.`,
      snapshot: async () => {
        const now = { officeWideLimit: await this.limits.officeWideLimit() };
        return { title: "Office-wide limit", decidedBy: now, values: now };
      },
    });
  }

  private archivePeriod(): AnyOfficeSettingsHandler {
    return handler({
      action: SET_ARCHIVE_PERIOD_ACTION,
      handle: async ({ archivePeriod }: ArchivePeriod): Promise<ArchivePeriod> => {
        await this.limits.changeArchivePeriod(archivePeriod);
        return { archivePeriod };
      },
      response: (period: ArchivePeriod) => period,
      words: ({ archivePeriod }: ArchivePeriod) =>
        `A Done or Dropped Task is archived after ${archivePeriod} days.`,
      snapshot: async () => {
        const now = { archivePeriod: await this.limits.archivePeriod() };
        return { title: "Archive period", decidedBy: now, values: now };
      },
    });
  }

  /** Caps that don't fit the engines listed now are refused as 400, "caps: ...", the same words to an Agent. */
  private usage(): AnyOfficeSettingsHandler {
    return handler({
      action: SET_USAGE_SETTINGS_ACTION,
      handle: async (request: UsageSettingsRequest): Promise<UsageSettingsRequest> => {
        const settings = usageSettingsOf(request);
        const problem = await this.limits.capsProblem(settings.caps);
        if (problem !== undefined) throw new BadRequestException(`caps: ${problem}`);
        return toUsageSettingsResponse(await this.limits.changeUsageSettings(settings));
      },
      response: (settings: UsageSettingsRequest) => settings,
      words: ({ measures }: UsageSettingsRequest) =>
        measures.length === 0
          ? "Usage estimates are off, and the engines' caps are saved."
          : `Usage is measured in ${measures.join(" and ")}, and the engines' caps are saved.`,
      snapshot: async () => {
        const now = toUsageSettingsResponse(await this.limits.usageSettings());
        return { title: "Usage", decidedBy: { ...now }, values: { ...now } };
      },
    });
  }
}

function usageSettingsOf({ measures, caps }: UsageSettingsRequest): UsageSettings {
  return {
    measures,
    caps: caps.map(({ engineId, windows, dailyTokens, dailyDollars }) => ({
      engineId,
      windows: windows && {
        fiveHour: windows.fiveHour ?? undefined,
        sevenDay: windows.sevenDay ?? undefined,
      },
      dailyTokens: dailyTokens ?? undefined,
      dailyDollars: dailyDollars ?? undefined,
    })),
  };
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
