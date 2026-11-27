import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  CANCEL_OFFICE_RESTART_ACTION,
  CANCEL_OFFICE_UPDATE_ACTION,
  CHECK_FOR_UPDATES_ACTION,
  OFFICE_UPDATE_OFFICE_ACTIONS,
  SCHEDULE_OFFICE_RESTART_ACTION,
  SCHEDULE_OFFICE_UPDATE_ACTION,
  type OfficeAction,
} from "@the-office/contracts";
import type { z } from "zod";
import {
  officeActionDraft,
  officeActionTool,
  OfficeToolRegistry,
  type OfficeToolResult,
} from "../../../engine/index.js";
import { OfficeRestarts } from "../../application/office-restarts.js";
import { OfficeUpdates, type OfficeUpdateCheck } from "../../application/office-updates.js";
import { officeVersionWords } from "../../domain/office-version.js";
import { ScheduledExitRefused } from "../../domain/scheduled-exit-refused.js";
import { officeUpdateResponse } from "../http/office-update-response.js";

/** What an Agent reads once an update or restart is scheduled: what it waits for and what it ends. */
const SCHEDULED_WORDS =
  "It waits for the running work to end, this session's turn included, and then ends every session.";

/**
 * One of Office updates' Office actions as Office updates carries it out: `handle` for the user's
 * request, an Agent's call and an approved call alike, its result answered to the web by `response`
 * and worded to the Agent by `words`.
 */
interface OfficeUpdateActionHandler<Action extends OfficeAction, Result> {
  readonly action: Action;
  /** What the approval card calls what the action changes: the update or the restart. */
  readonly subjectTitle: string;
  handle(): Promise<Result>;
  response(result: Result): Promise<z.input<Action["answer"]>>;
  words(result: Result): string;
}

type AnyOfficeUpdateActionHandler = OfficeUpdateActionHandler<OfficeAction, unknown>;

function handler<Action extends OfficeAction, Result>(
  each: OfficeUpdateActionHandler<Action, Result>,
): AnyOfficeUpdateActionHandler {
  return each as unknown as AnyOfficeUpdateActionHandler;
}

/**
 * Office updates' Office actions (the Office action convention): the one handler of each action
 * Office updates declares, which its route (`OfficeUpdateOfficeActionsController`) and its Office
 * tool, registered here, both call. Throws at start for a declared action with no handler.
 */
@Injectable()
export class OfficeUpdateOfficeActions implements OnModuleInit {
  private readonly handlers: ReadonlyMap<string, AnyOfficeUpdateActionHandler>;

  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly updates: OfficeUpdates,
    private readonly restarts: OfficeRestarts,
  ) {
    this.handlers = new Map(
      [
        this.checkForUpdates(),
        this.scheduleOfficeUpdate(),
        this.cancelOfficeUpdate(),
        this.scheduleOfficeRestart(),
        this.cancelOfficeRestart(),
      ].map((each) => [each.action.name, each]),
    );
    const unhandled = OFFICE_UPDATE_OFFICE_ACTIONS.filter(({ name }) => !this.handlers.has(name));
    if (unhandled.length > 0) {
      throw new Error(`No handler carries out ${unhandled.map(({ name }) => name).join(", ")}.`);
    }
  }

  onModuleInit(): void {
    for (const each of this.handlers.values()) {
      this.registry.register(
        officeActionTool(each.action, () => answered(async () => each.words(await each.handle())), {
          draft: async (input) =>
            officeActionDraft(each.action, input, {
              title: each.subjectTitle,
              decidedBy: {},
              values: {},
            }),
          applyFor: () => answered(async () => each.words(await each.handle())),
        }),
      );
    }
  }

  /** The route's answer to the action. */
  async answer(action: OfficeAction): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`Office updates carries out no Office action ${action.name}.`);
    return each.response(await each.handle());
  }

  private checkForUpdates(): AnyOfficeUpdateActionHandler {
    return handler({
      action: CHECK_FOR_UPDATES_ACTION,
      subjectTitle: "The Office update",
      handle: () => this.updates.check(),
      response: () => officeUpdateResponse(this.updates, this.restarts),
      words: checkWords,
    });
  }

  private scheduleOfficeUpdate(): AnyOfficeUpdateActionHandler {
    return handler({
      action: SCHEDULE_OFFICE_UPDATE_ACTION,
      subjectTitle: "The Office update",
      handle: () => this.updates.schedule(),
      response: async () => undefined,
      words: () => `The Office update is scheduled. ${SCHEDULED_WORDS}`,
    });
  }

  private cancelOfficeUpdate(): AnyOfficeUpdateActionHandler {
    return handler({
      action: CANCEL_OFFICE_UPDATE_ACTION,
      subjectTitle: "The Office update",
      handle: () => this.updates.cancel(),
      response: async () => undefined,
      words: () => "The scheduled Office update is cancelled.",
    });
  }

  private scheduleOfficeRestart(): AnyOfficeUpdateActionHandler {
    return handler({
      action: SCHEDULE_OFFICE_RESTART_ACTION,
      subjectTitle: "The Office restart",
      handle: () => this.restarts.schedule(),
      response: async () => undefined,
      words: () => `The Office restart is scheduled. ${SCHEDULED_WORDS}`,
    });
  }

  private cancelOfficeRestart(): AnyOfficeUpdateActionHandler {
    return handler({
      action: CANCEL_OFFICE_RESTART_ACTION,
      subjectTitle: "The Office restart",
      handle: () => this.restarts.cancel(),
      response: async () => undefined,
      words: () => "The scheduled Office restart is cancelled.",
    });
  }
}

/** A refused schedule or cancel answers the Agent in its reasons; anything else fails the call. */
async function answered(read: () => Promise<string>): Promise<OfficeToolResult> {
  try {
    return { text: await read(), isError: false };
  } catch (error) {
    if (error instanceof ScheduledExitRefused) {
      return { text: error.reasons.join(" "), isError: true };
    }
    throw error;
  }
}

/** What the check found, in words: its problem, the versions or commits newer than this Office, or none. */
function checkWords({ problem, behind, releases }: OfficeUpdateCheck): string {
  if (problem) return `Checked for updates, but couldn't read them: ${problem}`;
  const newer = [
    ...releases.map(({ version }) => version),
    ...behind.map(({ commit }) => officeVersionWords(commit)),
  ];
  return newer.length === 0
    ? "Checked for updates: The Office is up to date."
    : `Checked for updates: ${newer.join(", ")} newer than this Office, newest first.`;
}
