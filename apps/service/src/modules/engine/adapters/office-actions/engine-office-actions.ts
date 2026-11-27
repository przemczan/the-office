import {
  BadGatewayException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  type OnModuleInit,
} from "@nestjs/common";
import {
  ENGINES_OFFICE_ACTIONS,
  REFRESH_ENGINE_MODELS_ACTION,
  REMOVE_ENGINE_ACTION,
  SAVE_ENGINE_SETTINGS_ACTION,
  type OfficeAction,
  type SaveEngineSettings,
} from "@the-office/contracts";
import type { z } from "zod";
import { EngineModelLists } from "../../application/engine-model-lists.js";
import {
  EngineSettingsService,
  type EngineSettingsChange,
} from "../../application/engine-settings-service.js";
import { OfficeToolRegistry } from "../../application/office-tool-registry.js";
import { EngineRefused } from "../../domain/engine-refused.js";
import {
  offeredModelPrices,
  type EngineEdit,
  type EngineSettings,
} from "../../domain/engine-settings.js";
import { EngineSettingsRefused } from "../../domain/engine-settings-refused.js";
import { ENGINE_TYPE_NAMES, type Engine } from "../../domain/engines.js";
import type { OfficeToolDraft, OfficeToolResult } from "../../ports/office-tool.js";
import { officeActionDraft } from "../office-tools/office-action-draft.js";
import { officeActionTool } from "../office-tools/office-action-tool.js";
import { engineResponse, engineSettingsResponseOf } from "../http/engine-settings-responses.js";

const KEYS_ARE_THE_USERS =
  "API keys are the user's alone: leave `key` out and the key saved stays as it is. A sign-in, a code or a token is the user's too, given in Settings › Engines.";
const KEYS_STAY_AT_THEIR_ADDRESS =
  "A saved API key goes only to the base URL it was saved with: changing an API engine's base URL is the user's, while its key is saved.";

/** Who calls an action: the signed-in user, or a person (an Agent). */
export type EngineCaller = "user" | "person";

/**
 * One of Engine's Office actions as Engine carries it out: `handle` for the user's request and a
 * person's call alike (`by` tells them apart), its result answered to the web by `response` and
 * worded to the Agent by `words`; `draft` says what a call changes now, and `check` refuses a call
 * up front.
 */
interface EngineActionHandler<Action extends OfficeAction, Result> {
  readonly action: Action;
  handle(input: z.output<Action["input"]>, by: EngineCaller): Promise<Result>;
  response(result: Result): Promise<z.input<Action["answer"]>>;
  words(result: Result, input: z.output<Action["input"]>): string;
  draft(input: z.output<Action["input"]>): Promise<OfficeToolDraft>;
  check?(input: z.output<Action["input"]>): string | undefined;
}

type AnyEngineActionHandler = EngineActionHandler<OfficeAction, unknown>;

function handler<Action extends OfficeAction, Result>(
  each: EngineActionHandler<Action, Result>,
): AnyEngineActionHandler {
  return each as unknown as AnyEngineActionHandler;
}

/**
 * Engine's Office actions (the Office action convention): the one handler of each action Engine
 * declares, which its route (`EngineOfficeActionsController`) and its Office tool, registered here,
 * both call. Throws at start for a declared action with no handler.
 *
 * A person never reads or changes a key or a sign-in, and never drops another engine: a call that
 * gives an API key is refused, the saved key stays (a Save keeps it when `key` is left out) and is
 * never moved to another base URL, and a person's Save is merged onto the engines as they are, each engine it leaves out staying. The
 * user's request keeps the whole-set Save of the page.
 */
@Injectable()
export class EngineOfficeActions implements OnModuleInit {
  private readonly handlers: ReadonlyMap<string, AnyEngineActionHandler>;

  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly settings: EngineSettingsService,
    private readonly modelLists: EngineModelLists,
  ) {
    this.handlers = new Map(
      [this.saveEngineSettings(), this.removeEngine(), this.refreshEngineModels()].map((each) => [
        each.action.name,
        each,
      ]),
    );
    const unhandled = ENGINES_OFFICE_ACTIONS.filter(({ name }) => !this.handlers.has(name));
    if (unhandled.length > 0) {
      throw new Error(`No handler carries out ${unhandled.map(({ name }) => name).join(", ")}.`);
    }
  }

  onModuleInit(): void {
    for (const each of this.handlers.values()) {
      const run = (input: Record<string, unknown>): Promise<OfficeToolResult> =>
        answered(async () => each.words(await each.handle(input, "person"), input));
      const tool = officeActionTool(each.action, (input) => run(input), {
        draft: (input) => each.draft(input),
        applyFor: (input) => run(input),
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
    if (!each) throw new Error(`Engine carries out no Office action ${action.name}.`);
    return each.response(await each.handle(input as never, "user"));
  }

  private saveEngineSettings(): AnyEngineActionHandler {
    return handler({
      action: SAVE_ENGINE_SETTINGS_ACTION,
      check: ({ engines }) => (engines.some(givesKey) ? KEYS_ARE_THE_USERS : undefined),
      handle: async (input, by): Promise<EngineSettings> => {
        if (by === "person" && input.engines.some(givesKey)) {
          throw new ConflictException(KEYS_ARE_THE_USERS);
        }
        const stored = await this.settings.current();
        if (by === "person" && input.engines.some((edit) => redirectsKey(edit, stored.engines))) {
          throw new ConflictException(KEYS_STAY_AT_THEIR_ADDRESS);
        }
        const { engines, ...rest } = input;
        const change: EngineSettingsChange = {
          ...rest,
          engines: by === "person" ? mergedEngines(stored.engines, engines) : engines,
          officeDefault:
            rest.officeDefault === undefined ? stored.officeDefault : rest.officeDefault,
          searchEndpoint:
            rest.searchEndpoint === undefined ? stored.searchEndpoint : rest.searchEndpoint,
          modelPrices: rest.modelPrices ?? offeredModelPrices(stored),
        };
        return this.settings.change(change);
      },
      response: (saved: EngineSettings) => engineSettingsResponseOf(this.settings, saved),
      words: (saved: EngineSettings) =>
        `The engines are saved: ${saved.engines
          .map(({ name, kind }) => `${name} (${ENGINE_TYPE_NAMES[kind]})`)
          .join(", ")}.`,
      draft: async (input) => {
        const stored = await this.settings.current();
        // Never a key: the call's own is left out, and the engines shown only tell it set or not.
        const shown = { ...input, engines: input.engines.map(withoutKey) };
        return officeActionDraft(SAVE_ENGINE_SETTINGS_ACTION, shown, {
          title: "Engines",
          decidedBy: {},
          values: {
            engines: stored.engines.map(engineResponse),
            officeDefault: stored.officeDefault,
            searchEndpoint: stored.searchEndpoint,
            modelPrices: offeredModelPrices(stored),
            standInEngines: stored.standInEngines,
            askBeforeSwitchAbove: stored.askBeforeSwitchAbove,
          },
        });
      },
    });
  }

  private removeEngine(): AnyEngineActionHandler {
    return handler({
      action: REMOVE_ENGINE_ACTION,
      handle: ({ engineId, replacement }): Promise<EngineSettings> =>
        this.settings.remove(engineId, replacement ?? null),
      response: (left: EngineSettings) => engineSettingsResponseOf(this.settings, left),
      words: (left: EngineSettings, { engineId, replacement }) =>
        `Removed the engine ${engineId}${replacement ? `, its references moved to ${replacement}` : ""}. Engines left: ${left.engines.map(({ name }) => name).join(", ") || "none"}.`,
      draft: async (input) => {
        const stored = await this.settings.current();
        const engine = stored.engines.find(({ id }) => id === input.engineId);
        return officeActionDraft(REMOVE_ENGINE_ACTION, input, {
          title: engine?.name ?? input.engineId,
          decidedBy: { engines: stored.engines.map(({ id }) => id) },
          values: {},
        });
      },
    });
  }

  private refreshEngineModels(): AnyEngineActionHandler {
    return handler({
      action: REFRESH_ENGINE_MODELS_ACTION,
      handle: async ({ engineId }): Promise<Engine | undefined> => {
        const refreshed = await this.modelLists.refresh(engineId).catch((error: unknown) => {
          if (error instanceof EngineRefused) throw new UnprocessableEntityException(error.message);
          throw error;
        });
        switch (refreshed.outcome) {
          case "listed":
          case "none-listed":
            return (await this.settings.current()).engines.find(({ id }) => id === engineId);
          case "not-listed":
            throw new NotFoundException("Settings › Engines lists no engine by that id.");
          case "lists-none":
            throw new UnprocessableEntityException(
              `The models of ${refreshed.engine.name} (${ENGINE_TYPE_NAMES[refreshed.engine.kind]}) aren't asked of its account.`,
            );
          case "failed":
            throw new BadGatewayException(
              `${refreshed.engine.name} didn't list its models: ${refreshed.error}`,
            );
        }
      },
      response: () => Promise.resolve(undefined),
      words: (engine: Engine | undefined) =>
        `${engine?.name ?? "The engine"} listed its models; they are refreshed.`,
      draft: async (input) => {
        const stored = await this.settings.current();
        const engine = stored.engines.find(({ id }) => id === input.engineId);
        return officeActionDraft(REFRESH_ENGINE_MODELS_ACTION, input, {
          title: engine?.name ?? input.engineId,
          decidedBy: { listed: engine !== undefined },
          values: {},
        });
      },
    });
  }
}

type GivenEngine = SaveEngineSettings["engines"][number];

function givesKey(engine: GivenEngine): boolean {
  return "key" in engine && engine.key !== undefined;
}

function withoutKey(edit: GivenEngine): GivenEngine {
  if (!("key" in edit)) return edit;
  const { key: _key, ...rest } = edit;
  return rest;
}

const withoutTrailingSlashes = (address: string): string => address.trim().replace(/\/+$/, "");

/**
 * Whether an edit keeps an API engine's saved key but points it at another base URL, which would
 * let a person read the key by having it sent to an address they control.
 */
function redirectsKey(edit: EngineEdit, stored: readonly Engine[]): boolean {
  if (edit.kind !== "openai-compatible-api" || edit.id === undefined) return false;
  const kept = stored.find(({ id }) => id === edit.id);
  if (kept?.kind !== "openai-compatible-api" || kept.key === "") return false;
  return withoutTrailingSlashes(edit.baseUrl) !== withoutTrailingSlashes(kept.baseUrl);
}

/**
 * The engines as they are with the edits of a person's Save laid on: an engine named by its id is
 * replaced in its place, a new one is added at the end, and every other engine stays exactly as it
 * is, its key and sign-in kept.
 */
function mergedEngines(stored: readonly Engine[], edits: readonly EngineEdit[]): EngineEdit[] {
  const named = new Map<string, EngineEdit>();
  for (const edit of edits) if (edit.id !== undefined) named.set(edit.id, edit);
  const storedIds = new Set(stored.map(({ id }) => id));
  return [
    ...stored.map((engine) => named.get(engine.id) ?? editOf(engine)),
    ...edits.filter(({ id }) => id === undefined || !storedIds.has(id)),
  ];
}

/** An engine as an edit that changes nothing: no key, token or sign-in, so each is kept. */
function editOf(engine: Engine): EngineEdit {
  const { id, name, defaultModel, defaultEffort } = engine;
  const common = { id, name, defaultModel, defaultEffort };
  switch (engine.kind) {
    case "claude-code":
      return { ...common, kind: engine.kind, claudeCodeP: engine.claudeCodeP };
    case "codex":
    case "copilot-cli":
    case "gemini-cli":
      return { ...common, kind: engine.kind };
    case "openai-compatible-api":
      return {
        ...common,
        kind: engine.kind,
        baseUrl: engine.baseUrl,
        models: engine.models.map((model) => ({ ...model })),
      };
  }
}

/** A refusal answers the Agent in its words; anything else fails the call. */
async function answered(read: () => Promise<string>): Promise<OfficeToolResult> {
  try {
    return { text: await read(), isError: false };
  } catch (error) {
    if (error instanceof HttpException || error instanceof EngineSettingsRefused) {
      return { text: error.message, isError: true };
    }
    throw error;
  }
}
