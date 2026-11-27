import {
  ConflictException,
  HttpException,
  Injectable,
  UnprocessableEntityException,
  type OnModuleInit,
} from "@nestjs/common";
import {
  CHECK_GRAFANA_ACTION,
  SAVE_TELEMETRY_ACTION,
  START_BUNDLED_GRAFANA_ACTION,
  TELEMETRY_OFFICE_ACTIONS,
  type GrafanaCheckAnswer as GrafanaCheckResponse,
  telemetryChoiceSchema,
  type OfficeAction,
  type SaveTelemetry,
  type TelemetryChoice,
  type TelemetrySettings,
} from "@the-office/contracts";
import type { z } from "zod";
import {
  officeActionDraft,
  officeActionTool,
  OfficeToolRegistry,
  type OfficeToolDraft,
  type OfficeToolResult,
} from "../../../engine/index.js";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { BundledGrafanaKeeper } from "../../../../platform/telemetry/bundled-grafana/bundled-grafana-keeper.js";
import { choiceToSave, savedChoiceOf } from "../../../../platform/telemetry/telemetry-choice.js";
import { SavedTelemetrySetting } from "../../../../platform/telemetry/saved-telemetry-setting.js";
import { RunningTelemetrySettings } from "../../../../platform/telemetry/telemetry-in-effect.js";
import { TelemetrySettingsView } from "../../../../platform/telemetry/telemetry-settings-view.js";
import { isSetByEnvironment } from "../../../../platform/telemetry/telemetry-settings.js";
import { GrafanaCheck, type GrafanaCheckAnswer } from "../../application/grafana-check.js";

const SET_BY_ENVIRONMENT =
  "The environment sets telemetry (the OTEL_ variables in .env), so it can't be changed here.";
const BUNDLED_GRAFANA_NOT_CHOSEN = "Bundled Grafana isn't the saved choice, so it isn't started.";
const CREDENTIALS_ARE_THE_USERS =
  "Header values and a Grafana read token are the user's alone: leave `headers` and `grafana.readToken` out, and the ones saved stay as they are.";
const CREDENTIALS_STAY_AT_THEIR_ADDRESS =
  "Saved header values and a saved read token go only to the address they were saved with: changing the endpoint or the Grafana read address is the user's, while they are saved.";
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
  response(result: Result): z.input<Action["answer"]> | Promise<z.input<Action["answer"]>>;
  words(result: Result): string;
  /** What a call changes now, when it is more than the call itself; never a credential. */
  draft?(input: z.output<Action["input"]>): Promise<OfficeToolDraft>;
  /** The refusal of a call up front, in the Agent's words. */
  check?(input: z.output<Action["input"]>): string | undefined;
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
      [this.saveTelemetry(), this.checkGrafana(), this.startBundledGrafana()].map((each) => [
        each.action.name,
        each,
      ]),
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
      const tool = officeActionTool(each.action, run, {
        draft: (input) =>
          each.draft?.(input) ??
          Promise.resolve(
            officeActionDraft(each.action, input, {
              title: "Telemetry",
              decidedBy: {},
              values: {},
            }),
          ),
        applyFor: run,
      });
      this.registry.register(
        tool.authority && each.check
          ? {
              ...tool,
              authority: {
                ...tool.authority,
                check: (input) => Promise.resolve(each.check?.(each.action.input.parse(input))),
              },
            }
          : tool,
      );
    }
  }

  /** The route's answer to the action, carried out for the signed-in user. */
  async answer(action: OfficeAction, input: unknown): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`Telemetry carries out no Office action ${action.name}.`);
    return each.response(await each.handle(input as never, "user"));
  }

  private saveTelemetry(): AnyTelemetryActionHandler {
    return handler({
      action: SAVE_TELEMETRY_ACTION,
      check: (input) => (givesCredentials(input) ? CREDENTIALS_ARE_THE_USERS : undefined),
      handle: async (input, by): Promise<TelemetryChoice | undefined> => {
        if (by === "person" && givesCredentials(input)) {
          throw new ConflictException(CREDENTIALS_ARE_THE_USERS);
        }
        const sent = new ContractPipe(telemetryChoiceSchema).transform(input);
        if (isSetByEnvironment(this.running.inEffect)) {
          throw new ConflictException({
            message: SET_BY_ENVIRONMENT,
            reasons: [SET_BY_ENVIRONMENT],
          });
        }
        let kept: TelemetryChoice | undefined;
        await this.saved.change((saved) => {
          if (by === "person" && redirectsCredentials(sent, saved)) {
            throw new ConflictException(CREDENTIALS_STAY_AT_THEIR_ADDRESS);
          }
          const checked = choiceToSave(sent, saved);
          if (checked.problems) {
            throw new UnprocessableEntityException({
              message: checked.problems.join(" "),
              reasons: checked.problems,
            });
          }
          kept = checked.choice;
          return checked.choice;
        });
        if (kept?.kind === "bundled-grafana") void this.bundledGrafana.start();
        return kept;
      },
      response: (kept: TelemetryChoice | undefined): Promise<TelemetrySettings> =>
        this.view.of(kept),
      words: (kept: TelemetryChoice | undefined) => {
        const saved = savedChoiceOf(kept);
        switch (saved.kind) {
          case "off":
            return "Telemetry is off from the next start.";
          case "bundled-grafana":
            return "Telemetry goes to the bundled Grafana from the next start.";
          case "own-endpoint":
            return `Telemetry goes to ${saved.endpoint} from the next start.`;
        }
      },
      draft: async (input) => {
        const saved = savedChoiceOf(await this.saved.read());
        const own = saved.kind === "own-endpoint" ? saved : undefined;
        // Never a credential: the call's own are left out, and the saved ones are never read here.
        const { headers: _headers, grafana, ...given } = input;
        return officeActionDraft(
          SAVE_TELEMETRY_ACTION,
          {
            ...given,
            ...(grafana ? { grafana: { readAddress: grafana.readAddress } } : { grafana }),
          },
          {
            title: "Telemetry",
            decidedBy: {},
            values: {
              kind: saved.kind,
              endpoint: own?.endpoint,
              timeoutMilliseconds: own?.timeoutMilliseconds,
              grafana: own?.grafana ? { readAddress: own.grafana.readAddress } : null,
            },
          },
        );
      },
    });
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

const withoutTrailingSlashes = (address: string | undefined): string =>
  (address ?? "").trim().replace(/\/+$/, "");

function sameAddress(given: string | undefined, saved: string): boolean {
  return withoutTrailingSlashes(given) === withoutTrailingSlashes(saved);
}

/**
 * Whether a call would keep a saved header value or read token but send it to another address, which
 * would let a person read a credential by redirecting it.
 */
function redirectsCredentials(sent: SaveTelemetry, saved: TelemetryChoice | undefined): boolean {
  if (sent.kind !== "own-endpoint" || saved?.kind !== "own-endpoint") return false;
  if ((saved.headers?.length ?? 0) > 0 && !sameAddress(sent.endpoint, saved.endpoint)) return true;
  const savedGrafana = saved.grafana;
  return Boolean(
    savedGrafana?.readToken &&
    sent.grafana &&
    !sameAddress(sent.grafana.readAddress, savedGrafana.readAddress),
  );
}

/** Whether a call gives a header's value or a Grafana read token, which only the user gives. */
function givesCredentials({ headers, grafana }: SaveTelemetry): boolean {
  return headers !== undefined || Boolean(grafana?.readToken);
}
