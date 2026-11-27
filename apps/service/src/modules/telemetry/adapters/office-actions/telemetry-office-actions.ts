import { ConflictException, HttpException, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  CHECK_GRAFANA_ACTION,
  START_BUNDLED_GRAFANA_ACTION,
  TELEMETRY_OFFICE_ACTIONS,
  type GrafanaCheckAnswer as GrafanaCheckResponse,
  type OfficeAction,
  type TelemetrySettings,
} from "@the-office/contracts";
import type { z } from "zod";
import {
  officeActionDraft,
  officeActionTool,
  OfficeToolRegistry,
  type OfficeToolResult,
} from "../../../engine/index.js";
import { BundledGrafanaKeeper } from "../../../../platform/telemetry/bundled-grafana/bundled-grafana-keeper.js";
import { SavedTelemetrySetting } from "../../../../platform/telemetry/saved-telemetry-setting.js";
import { RunningTelemetrySettings } from "../../../../platform/telemetry/telemetry-in-effect.js";
import { TelemetrySettingsView } from "../../../../platform/telemetry/telemetry-settings-view.js";
import { isSetByEnvironment } from "../../../../platform/telemetry/telemetry-settings.js";
import { GrafanaCheck, type GrafanaCheckAnswer } from "../../application/grafana-check.js";

const SET_BY_ENVIRONMENT =
  "The environment sets telemetry (the OTEL_ variables in .env), so it can't be changed here.";
const BUNDLED_GRAFANA_NOT_CHOSEN = "Bundled Grafana isn't the saved choice, so it isn't started.";
const READ_TOKEN_IS_THE_USERS =
  "Only the user can give a read token; leave it out to test with the saved one at the saved read address.";

/** Who calls an action: the signed-in user, or a person (an Agent). */
export type TelemetryCaller = "user" | "person";

/**
 * One of Telemetry's Office actions as Telemetry carries it out: `handle` for the user's request,
 * a person's call and an approved call alike, its result answered to the web by `response` and
 * worded to the Agent by `words`.
 */
interface TelemetryActionHandler<Action extends OfficeAction, Result> {
  readonly action: Action;
  handle(input: z.output<Action["input"]>, by: TelemetryCaller): Promise<Result>;
  response(result: Result): z.input<Action["answer"]>;
  words(result: Result): string;
}

type AnyTelemetryActionHandler = TelemetryActionHandler<OfficeAction, unknown>;

function handler<Action extends OfficeAction, Result>(
  each: TelemetryActionHandler<Action, Result>,
): AnyTelemetryActionHandler {
  return each as unknown as AnyTelemetryActionHandler;
}

/**
 * Telemetry's Office actions (the Office action convention): the one handler of each action
 * Telemetry declares, which its route (`TelemetryOfficeActionsController`) and its Office tool,
 * registered here, both call. Throws at start for a declared action with no handler.
 */
@Injectable()
export class TelemetryOfficeActions implements OnModuleInit {
  private readonly handlers: ReadonlyMap<string, AnyTelemetryActionHandler>;

  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly grafanaCheck: GrafanaCheck,
    private readonly saved: SavedTelemetrySetting,
    private readonly running: RunningTelemetrySettings,
    private readonly bundledGrafana: BundledGrafanaKeeper,
    private readonly view: TelemetrySettingsView,
  ) {
    this.handlers = new Map(
      [this.checkGrafana(), this.startBundledGrafana()].map((each) => [each.action.name, each]),
    );
    const unhandled = TELEMETRY_OFFICE_ACTIONS.filter(({ name }) => !this.handlers.has(name));
    if (unhandled.length > 0) {
      throw new Error(`No handler carries out ${unhandled.map(({ name }) => name).join(", ")}.`);
    }
  }

  onModuleInit(): void {
    for (const each of this.handlers.values()) {
      const run = (input: never): Promise<OfficeToolResult> =>
        answered(async () => each.words(await each.handle(input, "person")));
      this.registry.register(
        officeActionTool(each.action, run, {
          draft: async (input) =>
            officeActionDraft(each.action, input, {
              title: "Telemetry",
              decidedBy: {},
              values: {},
            }),
          applyFor: run,
        }),
      );
    }
  }

  /** The route's answer to the action, carried out for the signed-in user. */
  async answer(action: OfficeAction, input: unknown): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`Telemetry carries out no Office action ${action.name}.`);
    return each.response(await each.handle(input as never, "user"));
  }

  private checkGrafana(): AnyTelemetryActionHandler {
    return handler({
      action: CHECK_GRAFANA_ACTION,
      handle: async ({ readAddress, readToken }, by): Promise<GrafanaCheckAnswer> => {
        if (by === "user") return this.grafanaCheck.check(readAddress.trim(), readToken?.trim());
        if (readToken) throw new ConflictException(READ_TOKEN_IS_THE_USERS);
        return this.grafanaCheck.checkAsPerson(readAddress.trim());
      },
      response: (answer: GrafanaCheckAnswer): GrafanaCheckResponse =>
        answer.state === "no-data-sources" ? { ...answer, missing: [...answer.missing] } : answer,
      words: (answer: GrafanaCheckAnswer) => {
        switch (answer.state) {
          case "reachable":
            return `Grafana answered with its data sources ${answer.prometheus} and ${answer.loki}.`;
          case "rejected":
            return "Grafana refused the read token.";
          case "unreachable":
            return `Grafana can't be reached: ${answer.problem}`;
          case "no-data-sources":
            return `Grafana lacks the data sources: ${answer.missing.join(", ")}.`;
        }
      },
    });
  }

  private startBundledGrafana(): AnyTelemetryActionHandler {
    return handler({
      action: START_BUNDLED_GRAFANA_ACTION,
      handle: async (): Promise<TelemetrySettings> => {
        if (isSetByEnvironment(this.running.inEffect)) {
          throw new ConflictException({
            message: SET_BY_ENVIRONMENT,
            reasons: [SET_BY_ENVIRONMENT],
          });
        }
        const saved = await this.saved.read();
        if (saved?.kind !== "bundled-grafana") {
          throw new ConflictException({
            message: BUNDLED_GRAFANA_NOT_CHOSEN,
            reasons: [BUNDLED_GRAFANA_NOT_CHOSEN],
          });
        }
        void this.bundledGrafana.start();
        return this.view.of(saved);
      },
      response: (settings: TelemetrySettings) => settings,
      words: ({ bundledGrafana }: TelemetrySettings) =>
        `The bundled Grafana is starting again (it is ${bundledGrafana.state}).`,
    });
  }
}

/** A refusal answers the Agent in its words; anything else fails the call. */
async function answered(read: () => Promise<string>): Promise<OfficeToolResult> {
  try {
    return { text: await read(), isError: false };
  } catch (error) {
    if (error instanceof HttpException) return { text: error.message, isError: true };
    throw error;
  }
}
