import {
  CLAUDE_CODE_MODELS,
  CODEX_MODELS,
  COPILOT_CLI_AUTO_MODEL,
  COPILOT_CLI_MODELS,
  engineIdFor,
  GEMINI_CLI_MODELS,
  MAX_WINDOW_START_TIMES,
  windowStartTimeSchema,
  type ApiEngine,
  type ApiEngineEdit,
  type ClaudeCodeEngineEdit,
  type CodexEngineEdit,
  type CopilotCliEngineEdit,
  type EngineEdit,
  type EngineId,
  type EngineKind,
  type EngineModelList,
  type EngineSettings,
  type EngineSettingsEdit,
  type EngineWindowStartEdit,
  type GeminiCliEngineEdit,
  type OfferedModel,
  type OfficeDefault,
  type SearchEndpoint,
  type WindowStartSettings,
} from "@the-office/contracts";
import type { EngineTypeChoice } from "../../../shell/engine-type-account-fields.tsx";
import {
  ENGINE_KINDS,
  modelLabel,
  noLongerOfferedModelLabel,
} from "../../../shell/engine-words.ts";
import { NO_PRICE_TEXT, priceOf, priceTextOf, type ModelPriceText } from "./model-price-fields.ts";

/**
 * Settings › Engines as the user edits it before Save: the saved settings with every key kept,
 * since a key is never sent back and an edit without one keeps it.
 */
export interface EngineSettingsDraft {
  /**
   * The Claude Code engines, then the Codex engines, then the Copilot CLI engines, then the API
   * endpoints, as Save sends them; a saved one is never left out.
   */
  readonly claudeCodeEngines: readonly ClaudeCodeEngineEdit[];
  readonly codexEngines: readonly CodexEngineEdit[];
  readonly copilotCliEngines: readonly CopilotCliEngineEdit[];
  readonly geminiCliEngines: readonly GeminiCliEngineEdit[];
  readonly apiEndpoints: readonly ApiEngineEdit[];
  /**
   * An engine type and one of its saved accounts; none only while no engine is saved, until the
   * first one saved takes it.
   */
  readonly officeDefault: OfficeDefault | null;
  readonly searchEndpoint: SearchEndpoint | null;
  /**
   * Each model's Model price as its fields read, by `offeredModelKey`. Kept apart from the models
   * offered, so only those offered when Saving are sent.
   */
  readonly modelPrices: Readonly<Record<string, ModelPriceText>>;
  /** The Stand-in Engines in order, each a saved engine's id. */
  readonly standInEngines: readonly EngineId[];
  /**
   * The context size in tokens above which switching a running Stage to a Stand-in Engine asks
   * first, as its field reads: text, since an emptied field isn't a size yet.
   */
  readonly askBeforeSwitchAbove: string;
  /**
   * Each engine with usage windows' Window start as its fields read, by engine id; an engine that
   * gained usage windows since the draft was made reads its saved one (`windowStartAt`).
   */
  readonly windowStarts: Readonly<Record<EngineId, WindowStartDraft>>;
}

/** An engine's Window start as its fields read. */
export interface WindowStartDraft {
  /** "Start at set times"; off, Save sends no times, whatever the list holds. */
  readonly setTimesOn: boolean;
  /** As the time fields read: `HH:MM`, or empty while a field is. */
  readonly startAtTimes: readonly string[];
  readonly startAfterReset: boolean;
}

/**
 * A model an engine's Models and prices lists; a Claude or Codex model's engine is null, a Copilot
 * CLI or API model's its own.
 */
export type PricedModel = Pick<OfferedModel, "engineId" | "model">;

/** A drafted engine with the id Save gives it. */
export type Drafted<Edit extends EngineEdit> = Edit & { readonly id: EngineId };

export type DraftedEndpoint = Drafted<ApiEngineEdit>;

/** The drafted engines with the ids Save gives them, of each kind in order. */
export interface DraftedEngines {
  readonly claudeCodeEngines: readonly Drafted<ClaudeCodeEngineEdit>[];
  readonly codexEngines: readonly Drafted<CodexEngineEdit>[];
  readonly copilotCliEngines: readonly Drafted<CopilotCliEngineEdit>[];
  readonly geminiCliEngines: readonly Drafted<GeminiCliEngineEdit>[];
  readonly apiEndpoints: readonly DraftedEndpoint[];
}

export function draftOf({
  engines,
  officeDefault,
  searchEndpoint,
  modelPrices,
  standInEngines,
  askBeforeSwitchAbove,
  windowStarts,
}: EngineSettings): EngineSettingsDraft {
  return {
    claudeCodeEngines: engines.flatMap((engine) =>
      engine.kind === "claude-code" ? [{ ...engine }] : [],
    ),
    codexEngines: engines.flatMap((engine) => (engine.kind === "codex" ? [{ ...engine }] : [])),
    copilotCliEngines: engines.flatMap((engine) =>
      engine.kind === "copilot-cli" ? [{ ...engine }] : [],
    ),
    geminiCliEngines: engines.flatMap((engine) =>
      engine.kind === "gemini-cli" ? [{ ...engine }] : [],
    ),
    apiEndpoints: savedApiEngines(engines).map(({ keySet: _keySet, models, ...engine }) => ({
      ...engine,
      models: models.map((model) => ({ ...model })),
    })),
    officeDefault: officeDefault && { ...officeDefault },
    searchEndpoint: searchEndpoint && { ...searchEndpoint },
    modelPrices: Object.fromEntries(
      modelPrices.flatMap((offered) =>
        offered.price ? [[offeredModelKey(offered), priceTextOf(offered.price)]] : [],
      ),
    ),
    standInEngines: [...standInEngines],
    askBeforeSwitchAbove: String(askBeforeSwitchAbove),
    windowStarts: Object.fromEntries(
      windowStarts.map((windowStart) => [windowStart.engineId, windowStartDraftOf(windowStart)]),
    ),
  };
}

function windowStartDraftOf({
  startAtTimes,
  startAfterReset,
}: WindowStartSettings): WindowStartDraft {
  return { setTimesOn: startAtTimes.length > 0, startAtTimes: [...startAtTimes], startAfterReset };
}

/**
 * The engine's Window start as drafted: its saved one when it gained usage windows since the draft
 * was made, and none once it has none.
 */
export function windowStartAt(
  draft: EngineSettingsDraft,
  saved: EngineSettings,
  engineId: EngineId,
): WindowStartDraft | undefined {
  const savedWindowStart = saved.windowStarts.find((each) => each.engineId === engineId);
  if (!savedWindowStart) return undefined;
  return draft.windowStarts[engineId] ?? windowStartDraftOf(savedWindowStart);
}

export function withWindowStart(
  draft: EngineSettingsDraft,
  engineId: EngineId,
  windowStart: WindowStartDraft,
): EngineSettingsDraft {
  return { ...draft, windowStarts: { ...draft.windowStarts, [engineId]: windowStart } };
}

/**
 * What's wrong with each set time as its field reads, in order, or undefined for one that's fine:
 * empty, not `HH:MM`, or a repeat of one above it.
 */
export function setTimeProblems(startAtTimes: readonly string[]): readonly (string | undefined)[] {
  return startAtTimes.map((time, index) => {
    if (time === "") return "Give a time, or remove it.";
    if (!windowStartTimeSchema.safeParse(time).success) return "Give a time as HH:MM.";
    return startAtTimes.indexOf(time) < index ? `${time} is set already.` : undefined;
  });
}

/** What holds Save in the Window start, or undefined: a set time's problem, or too many times. */
export function windowStartProblem({
  setTimesOn,
  startAtTimes,
}: WindowStartDraft): string | undefined {
  if (!setTimesOn) return undefined;
  if (startAtTimes.length > MAX_WINDOW_START_TIMES) {
    return `At most ${MAX_WINDOW_START_TIMES} set times.`;
  }
  return setTimeProblems(startAtTimes).find((problem) => problem !== undefined);
}

/**
 * The Window start as Save sends it: its set times sorted, or none while they're off. A repeated
 * time holds Save (`windowStartProblem`), so the times sent are unique; it is kept here, so the
 * repeat counts as a change.
 */
function windowStartEditOf(
  engineId: EngineId,
  { setTimesOn, startAtTimes, startAfterReset }: WindowStartDraft,
): EngineWindowStartEdit {
  return {
    engineId,
    startAtTimes: setTimesOn ? startAtTimes.toSorted() : [],
    startAfterReset,
  };
}

/** Every saved Window start as Save sends it, or undefined while one holds Save. */
function windowStartEditsOf(
  draft: EngineSettingsDraft,
  saved: EngineSettings,
): EngineWindowStartEdit[] | undefined {
  const edits: EngineWindowStartEdit[] = [];
  for (const { engineId } of saved.windowStarts) {
    const windowStart = windowStartAt(draft, saved, engineId);
    if (!windowStart || windowStartProblem(windowStart) !== undefined) return undefined;
    edits.push(windowStartEditOf(engineId, windowStart));
  }
  return edits;
}

/** The API engines among the saved engines, in order. */
export function savedApiEngines(engines: EngineSettings["engines"]): readonly ApiEngine[] {
  return engines.filter((engine): engine is ApiEngine => engine.kind === "openai-compatible-api");
}

export function offeredModelKey({ engineId, model }: PricedModel): string {
  return JSON.stringify([engineId, model]);
}

/**
 * The drafted engines with the ids Save gives them: a new one's made from its name, apart from
 * every saved engine's and every drafted one's, in the order Save sends them (the Claude Code
 * engines, then the Codex engines, then the Copilot CLI engines), so an API endpoint's models read
 * by name and a price typed before Save lands on them.
 */
export function draftedEngines(draft: EngineSettingsDraft, saved: EngineSettings): DraftedEngines {
  const taken = new Set([
    ...saved.engines.map(({ id }) => id),
    ...[
      ...draft.claudeCodeEngines,
      ...draft.codexEngines,
      ...draft.copilotCliEngines,
      ...draft.geminiCliEngines,
      ...draft.apiEndpoints,
    ].flatMap(({ id }) => (id === undefined ? [] : [id])),
  ]);
  const idOf = ({ id, name }: EngineEdit): EngineId => {
    const given = id ?? engineIdFor(name, taken);
    taken.add(given);
    return given;
  };
  const claudeCodeEngines = draft.claudeCodeEngines.map((engine) => ({
    ...engine,
    id: idOf(engine),
    name: engine.name.trim(),
  }));
  const codexEngines = draft.codexEngines.map((engine) => ({
    ...engine,
    id: idOf(engine),
    name: engine.name.trim(),
  }));
  const copilotCliEngines = draft.copilotCliEngines.map((engine) => ({
    ...engine,
    id: idOf(engine),
    name: engine.name.trim(),
  }));
  const geminiCliEngines = draft.geminiCliEngines.map((engine) => ({
    ...engine,
    id: idOf(engine),
    name: engine.name.trim(),
  }));
  const apiEndpoints = draft.apiEndpoints.map((endpoint) => ({
    ...endpoint,
    id: idOf(endpoint),
    name: endpoint.name.trim(),
  }));
  return { claudeCodeEngines, codexEngines, copilotCliEngines, geminiCliEngines, apiEndpoints };
}

/** The engine's models as `saved` lists them, or undefined for one not saved yet or an API endpoint. */
export function modelListOf(
  saved: EngineSettings,
  engineId: EngineId | undefined,
): EngineModelList | undefined {
  return engineId === undefined
    ? undefined
    : saved.modelLists.find((modelList) => modelList.engineId === engineId);
}

/** A Claude Code, Codex, Copilot CLI or Gemini CLI engine as drafted. */
export type ListingEngineEdit =
  ClaudeCodeEngineEdit | CodexEngineEdit | CopilotCliEngineEdit | GeminiCliEngineEdit;

/**
 * The models the engine offers now: a saved engine's as `saved` lists them, else its type's fixed
 * list, as the service offers an engine its account hasn't listed models for yet.
 */
export function engineModelsOf(saved: EngineSettings, edit: ListingEngineEdit): readonly string[] {
  const listed = modelListOf(saved, edit.id);
  if (listed) return listed.models;
  switch (edit.kind) {
    case "claude-code":
      return CLAUDE_CODE_MODELS;
    case "codex":
      return CODEX_MODELS;
    case "copilot-cli":
      return COPILOT_CLI_MODELS;
    case "gemini-cli":
      return GEMINI_CLI_MODELS;
  }
}

/** Whether the engine's default model is one it no longer offers, kept until it is changed. */
export function defaultModelNoLongerOffered(
  saved: EngineSettings,
  edit: ListingEngineEdit,
): boolean {
  return edit.defaultModel !== "" && !engineModelsOf(saved, edit).includes(edit.defaultModel);
}

/**
 * The Default model's choices: the models the engine offers, then its default model when it no
 * longer offers it, kept and marked so, as Save sends it unchanged.
 */
export function defaultModelChoicesOf(
  saved: EngineSettings,
  edit: ListingEngineEdit,
): readonly { readonly value: string; readonly label: string }[] {
  const choices = engineModelsOf(saved, edit).map((model) => ({
    value: model,
    label: modelLabel(model),
  }));
  return defaultModelNoLongerOffered(saved, edit)
    ? [
        ...choices,
        { value: edit.defaultModel, label: noLongerOfferedModelLabel(edit.defaultModel) },
      ]
    : choices;
}

/**
 * Whether a model is one of the Codex models, whose price, as a Claude model's, has no engine: one
 * of the fixed Codex models or one a Codex engine lists.
 */
export function isCodexModel(model: string, saved: EngineSettings): boolean {
  return (
    (CODEX_MODELS as readonly string[]).includes(model) ||
    saved.engines.some(
      ({ id, kind }) => kind === "codex" && modelListOf(saved, id)?.models.includes(model) === true,
    )
  );
}

/**
 * The Claude models, as `saved` prices them: the models the Claude Code engines offer, those with
 * no engine that aren't Codex models.
 */
export function claudeModelsOf(saved: EngineSettings): readonly string[] {
  return saved.modelPrices
    .filter(({ engineId, model }) => engineId === null && !isCodexModel(model, saved))
    .map(({ model }) => model);
}

/**
 * The Codex models the draft offers: those its Codex engines offer, each once, a new one the fixed
 * list; none while no Codex engine is drafted.
 */
export function codexModelsOf(
  draft: EngineSettingsDraft,
  saved: EngineSettings,
): readonly string[] {
  return [...new Set(draft.codexEngines.flatMap((engine) => engineModelsOf(saved, engine)))];
}

/**
 * Every model the draft offers, as Save prices them: the Claude models as `saved` lists them, then
 * the Codex models the drafted Codex engines offer, then each drafted API endpoint's and each
 * drafted Copilot CLI and Gemini CLI engine's, priced on the engine; one without an id yet is left
 * out.
 */
export function offeredModelsOf(
  draft: EngineSettingsDraft,
  saved: EngineSettings,
): readonly PricedModel[] {
  const claudeModels = claudeModelsOf(saved).map((model) => ({ engineId: null, model }));
  const codexModels = codexModelsOf(draft, saved).map((model) => ({ engineId: null, model }));
  const drafted = draftedEngines(draft, saved);
  const apiModels = drafted.apiEndpoints.flatMap(({ id: engineId, models }) =>
    (engineId === "" ? [] : modelsOf({ models })).map((model) => ({ engineId, model })),
  );
  const copilotCliModels = drafted.copilotCliEngines.flatMap((engine) =>
    engine.id === ""
      ? []
      : engineModelsOf(saved, engine).map((model) => ({ engineId: engine.id, model })),
  );
  const geminiCliModels = drafted.geminiCliEngines.flatMap((engine) =>
    engine.id === ""
      ? []
      : engineModelsOf(saved, engine).map((model) => ({ engineId: engine.id, model })),
  );
  return [...claudeModels, ...codexModels, ...apiModels, ...copilotCliModels, ...geminiCliModels];
}

/** The models an API endpoint offers, by their trimmed ids, each once. */
export function modelsOf({ models }: Pick<ApiEngineEdit, "models">): readonly string[] {
  return [...new Set(models.map(({ id }) => id.trim()))].filter((model) => model !== "");
}

/** A model's price fields in the draft: empty for a model without a price. */
export function priceTextIn(draft: EngineSettingsDraft, offered: PricedModel): ModelPriceText {
  return draft.modelPrices[offeredModelKey(offered)] ?? NO_PRICE_TEXT;
}

/**
 * What Save sends, or undefined while a Model price's fields or the switch's context size don't
 * read as one.
 */
export function engineSettingsEditOf(
  draft: EngineSettingsDraft,
  saved: EngineSettings,
): EngineSettingsEdit | undefined {
  const modelPrices: OfferedModel[] = [];
  for (const offered of offeredModelsOf(draft, saved)) {
    const price = priceOf(priceTextIn(draft, offered));
    if (price === undefined) return undefined;
    modelPrices.push({ ...offered, price });
  }
  const askBeforeSwitchAbove = switchSizeOf(draft.askBeforeSwitchAbove);
  if (askBeforeSwitchAbove === undefined) return undefined;
  const windowStarts = windowStartEditsOf(draft, saved);
  if (windowStarts === undefined) return undefined;
  return {
    engines: [
      ...draft.claudeCodeEngines,
      ...draft.codexEngines,
      ...draft.copilotCliEngines,
      ...draft.geminiCliEngines,
      ...draft.apiEndpoints.map(withOfferedDefaultModel),
    ],
    officeDefault: draft.officeDefault,
    searchEndpoint: draft.searchEndpoint,
    modelPrices,
    standInEngines: [...draft.standInEngines],
    askBeforeSwitchAbove,
    windowStarts,
  };
}

/** What's wrong with the switch's context size as typed, or undefined: a whole number of tokens. */
export function switchSizeProblem(text: string): string | undefined {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) && Number.isSafeInteger(Number(trimmed))
    ? undefined
    : "Give a whole number of tokens, such as 100000, or 0 to always ask.";
}

/** The switch's context size the field gives, or undefined while it doesn't read as one. */
export function switchSizeOf(text: string): number | undefined {
  return switchSizeProblem(text) === undefined ? Number(text.trim()) : undefined;
}

/** An engine that may be listed as a Stand-in Engine, by its name, with its type once saved. */
export interface StandInChoice {
  readonly id: EngineId;
  readonly name: string;
  readonly kind: EngineKind | null;
}

/**
 * The Stand-in Engines as listed, by name, and the engines "Add a stand-in" offers: those saved,
 * still drafted and not listed yet, since a new engine has no id until Save.
 */
export function standInsOf(draft: EngineSettingsDraft): {
  readonly listed: readonly StandInChoice[];
  readonly addable: readonly StandInChoice[];
} {
  const choices = savedEnginesOf(draft).map(({ id, kind, name }) => ({ id, kind, name }));
  return {
    listed: draft.standInEngines.map(
      (id) => choices.find((choice) => choice.id === id) ?? { id, name: id, kind: null },
    ),
    addable: choices.filter(({ id }) => !draft.standInEngines.includes(id)),
  };
}

function withOfferedDefaultModel(endpoint: ApiEngineEdit): ApiEngineEdit {
  return { ...endpoint, defaultModel: offeredDefaultModel(endpoint) };
}

/**
 * An API endpoint's default model as Save takes it: the one picked while the endpoint still lists
 * it, else its first, so a model renamed or removed never leaves it on one it doesn't offer.
 */
export function offeredDefaultModel(endpoint: ApiEngineEdit): string {
  const models = modelsOf(endpoint);
  return models.includes(endpoint.defaultModel) ? endpoint.defaultModel : (models[0] ?? "");
}

/**
 * A new Claude Code engine, on the first saved Claude Code engine's default model while the fixed
 * Claude models have it, else the first of them: a new engine offers the fixed list until its
 * account lists its own.
 */
export function newClaudeCodeEngine(saved: EngineSettings): ClaudeCodeEngineEdit {
  return {
    name: "",
    kind: "claude-code",
    defaultModel: firstDefaultAmong(saved, "claude-code", CLAUDE_CODE_MODELS),
    defaultEffort: null,
    claudeCodeP: false,
  };
}

/**
 * A new Codex engine, on the first saved Codex engine's default model while the fixed Codex models
 * have it, else the first of them.
 */
export function newCodexEngine(saved: EngineSettings): CodexEngineEdit {
  return {
    name: "",
    kind: "codex",
    defaultModel: firstDefaultAmong(saved, "codex", CODEX_MODELS),
    defaultEffort: null,
  };
}

/** The first saved engine of `kind`'s default model when `fixedModels` has it, else their first. */
function firstDefaultAmong(
  saved: EngineSettings,
  kind: EngineKind,
  fixedModels: readonly [string, ...string[]],
): string {
  const firstDefault = saved.engines.find((engine) => engine.kind === kind)?.defaultModel;
  return firstDefault !== undefined && fixedModels.includes(firstDefault)
    ? firstDefault
    : fixedModels[0];
}

/** A new Copilot CLI engine, on Auto. */
export function newCopilotCliEngine(): CopilotCliEngineEdit {
  return {
    name: "",
    kind: "copilot-cli",
    defaultModel: COPILOT_CLI_AUTO_MODEL,
    defaultEffort: null,
  };
}

/** A new Gemini CLI engine, on Auto. */
export function newGeminiCliEngine(): GeminiCliEngineEdit {
  return { name: "", kind: "gemini-cli", defaultModel: GEMINI_CLI_MODELS[0], defaultEffort: null };
}

/** A saved engine still drafted, by its type and its name as typed. */
export interface SavedEngineChoice {
  readonly id: EngineId;
  readonly kind: EngineKind;
  readonly name: string;
}

/**
 * The saved engines still drafted, in the list's order: those the Office default and the Stand-in
 * Engines may name, since a new engine's id follows its name until Save.
 */
export function savedEnginesOf(draft: EngineSettingsDraft): readonly SavedEngineChoice[] {
  return [
    ...draft.claudeCodeEngines,
    ...draft.codexEngines,
    ...draft.copilotCliEngines,
    ...draft.geminiCliEngines,
    ...draft.apiEndpoints,
  ].flatMap(({ id, kind, name }) => (id === undefined ? [] : [{ id, kind, name: name.trim() }]));
}

/**
 * What the Office default may name: each engine type with a saved engine still drafted, in the
 * spec's order of types, with those engines as its accounts in the list's order.
 */
export function officeDefaultChoicesOf(draft: EngineSettingsDraft): readonly EngineTypeChoice[] {
  const saved = savedEnginesOf(draft);
  return ENGINE_KINDS.flatMap((engineType) => {
    const accounts = saved
      .filter(({ kind }) => kind === engineType)
      .map(({ id, name }) => ({ id, name }));
    return accounts.length === 0 ? [] : [{ engineType, accounts }];
  });
}

/**
 * The draft with the Office default on `engineType`, on its first account in the list's order;
 * unchanged while the type has no saved engine.
 */
export function withOfficeDefaultType(
  draft: EngineSettingsDraft,
  engineType: EngineKind,
): EngineSettingsDraft {
  const first = officeDefaultChoicesOf(draft).find((choice) => choice.engineType === engineType)
    ?.accounts[0];
  return first ? { ...draft, officeDefault: { engineType, engineId: first.id } } : draft;
}

/** Whether Save would change anything; a price typed for a model no longer offered doesn't count. */
export function draftChanged(draft: EngineSettingsDraft, saved: EngineSettings): boolean {
  return (
    JSON.stringify(whatSaveSees(draft, saved)) !==
    JSON.stringify(whatSaveSees(draftOf(saved), saved))
  );
}

function whatSaveSees(draft: EngineSettingsDraft, saved: EngineSettings): unknown {
  return {
    claudeCodeEngines: draft.claudeCodeEngines,
    codexEngines: draft.codexEngines,
    copilotCliEngines: draft.copilotCliEngines,
    geminiCliEngines: draft.geminiCliEngines,
    apiEndpoints: draft.apiEndpoints,
    officeDefault: draft.officeDefault,
    searchEndpoint: draft.searchEndpoint,
    modelPrices: offeredModelsOf(draft, saved).map((offered) => priceTextIn(draft, offered)),
    standInEngines: draft.standInEngines,
    askBeforeSwitchAbove:
      switchSizeOf(draft.askBeforeSwitchAbove) ?? draft.askBeforeSwitchAbove.trim(),
    // As Save sends them, so a time moved in the list or set while the times are off isn't a change.
    windowStarts: saved.windowStarts.flatMap(({ engineId }) => {
      const windowStart = windowStartAt(draft, saved, engineId);
      return windowStart ? [windowStartEditOf(engineId, windowStart)] : [];
    }),
  };
}

export const NEW_API_ENDPOINT: ApiEngineEdit = {
  name: "",
  kind: "openai-compatible-api",
  defaultModel: "",
  defaultEffort: null,
  baseUrl: "",
  models: [{ id: "", contextWindow: 0, seesImages: false }],
};

/** What saving does with an API endpoint's key: kept as it is, a new one, or none. */
export type KeyOnSave = "kept-set" | "kept-none" | "new" | "removed";

export function keyOnSave(edit: ApiEngineEdit, saved: ApiEngine | undefined): KeyOnSave {
  if (edit.key === undefined) return saved?.keySet ? "kept-set" : "kept-none";
  if (edit.key !== "") return "new";
  return saved?.keySet ? "removed" : "kept-none";
}

export const KEY_ON_SAVE_WORDS: Readonly<Record<KeyOnSave, string>> = {
  "kept-set": "A key is set. It is never shown; type a new one to replace it.",
  "kept-none": "No key, as a local server needs none.",
  new: "The key you typed is kept on Save.",
  removed: "The key is removed on Save.",
};

/** The Search endpoint as its base URL field reads it: none while the field is empty. */
export function searchEndpointOf(baseUrl: string): SearchEndpoint | null {
  const trimmed = baseUrl.trim();
  return trimmed === "" ? null : { baseUrl: trimmed };
}
