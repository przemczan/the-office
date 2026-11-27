import { BadRequestException, HttpException, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  RUN_ENVIRONMENTS_OFFICE_ACTIONS,
  SET_RUN_ENVIRONMENT_LIMITS_ACTION,
  type OfficeAction,
  type RunEnvironmentOfficeLimits as RunEnvironmentOfficeLimitsResponse,
  type RunEnvironmentOfficeLimitsChange,
} from "@the-office/contracts";
import type { z } from "zod";
import {
  officeActionDraft,
  officeActionTool,
  OfficeToolRegistry,
  type OfficeToolResult,
} from "../../../engine/index.js";
import { RunEnvironmentOfficeLimits } from "../../application/run-environment-office-limits.js";
import { toOptions, toResponse } from "../http/run-environment-office-limits-responses.js";

/**
 * One of Run environments' Office actions as it carries it out: `handle` for the user's request, an
 * Agent's call and a Proposal applied alike, its result answered to the web by `response` and
 * worded to the Agent by `words`.
 */
interface RunEnvironmentActionHandler<Action extends OfficeAction, Result> {
  readonly action: Action;
  handle(input: z.output<Action["input"]>): Promise<Result>;
  response(result: Result): z.input<Action["answer"]>;
  words(result: Result): string;
}

type AnyRunEnvironmentActionHandler = RunEnvironmentActionHandler<OfficeAction, unknown>;

function handler<Action extends OfficeAction, Result>(
  each: RunEnvironmentActionHandler<Action, Result>,
): AnyRunEnvironmentActionHandler {
  return each as unknown as AnyRunEnvironmentActionHandler;
}

/**
 * Run environments' Office actions (the Office action convention): the one handler of each action
 * it declares, which its route (`RunEnvironmentOfficeActionsController`) and its Office tool,
 * registered here, both call. Throws at start for a declared action with no handler. The draft
 * shows each limit given beside the one in force, which also fingerprints the change.
 */
@Injectable()
export class RunEnvironmentOfficeActions implements OnModuleInit {
  private readonly handlers: ReadonlyMap<string, AnyRunEnvironmentActionHandler>;

  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly officeLimits: RunEnvironmentOfficeLimits,
  ) {
    this.handlers = new Map([this.setLimits()].map((each) => [each.action.name, each]));
    const unhandled = RUN_ENVIRONMENTS_OFFICE_ACTIONS.filter(
      ({ name }) => !this.handlers.has(name),
    );
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
          draft: async (input) => officeActionDraft(each.action, input, await this.snapshot()),
          applyFor: run,
        }),
      );
    }
  }

  /** The route's answer to the action, carried out for the signed-in user. */
  async answer(action: OfficeAction, input: unknown): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`Run environments carries out no Office action ${action.name}.`);
    return each.response(await each.handle(input as never));
  }

  /** The limits as they are now: what a change decides by and what each field was. */
  private async snapshot() {
    const { runEnvironmentsAtOnce, cpuLimit, fixedCpus, memoryMegabytes, processes } = toResponse(
      await this.officeLimits.read(),
    );
    const values = { runEnvironmentsAtOnce, cpuLimit, fixedCpus, memoryMegabytes, processes };
    return { title: "Run environments limits", decidedBy: values, values };
  }

  /** A fixed number of CPUs above this computer's cores is refused, as 400 naming the field. */
  private setLimits(): AnyRunEnvironmentActionHandler {
    return handler({
      action: SET_RUN_ENVIRONMENT_LIMITS_ACTION,
      handle: async (change: RunEnvironmentOfficeLimitsChange) => {
        const options = toOptions(change);
        const problem = this.officeLimits.cpuLimitProblemOf(options.limits.cpuLimit);
        if (problem !== undefined) throw new BadRequestException(`fixedCpus: ${problem}`);
        return toResponse(await this.officeLimits.change(options));
      },
      response: (limits: RunEnvironmentOfficeLimitsResponse) => limits,
      words: (limits: RunEnvironmentOfficeLimitsResponse) =>
        `The run environments' limits are saved: ${limits.runEnvironmentsAtOnce} at once, ${limits.cpuLimit === "automatic" ? "CPUs Automatic" : `${limits.fixedCpus} CPUs`}, ${limits.memoryMegabytes} MB of memory and ${limits.processes} processes per service.`,
    });
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
