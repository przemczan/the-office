import {
  CODEX_MODELS,
  engineIdFor,
  type ApiEngine,
  type ApiEngineEdit,
  type ClaudeCodeEngineEdit,
  type CodexEngineEdit,
  type EngineEdit,
  type EngineId,
  type EngineModel,
  type EngineSettings,
  type EngineSettingsEdit,
  type OfferedModel,
  type SearchEndpoint,
} from "@the-office/contracts";
import { NO_PRICE_TEXT, priceOf, priceTextOf, type ModelPriceText } from "./model-price-fields.ts";

/**
 * Settings › Engines as the user edits it before Save: the saved settings with every key kept,
 * since a key is never sent back and an edit without one keeps it.
 */
export interface EngineSettingsDraft {
  /**
   * The Claude Code engines, then the Codex engines, then the API endpoints, as Save sends them; a
   * saved one is never left out.
   */
  readonly claudeCodeEngines: readonly ClaudeCodeEngineEdit[];
  readonly codexEngines: readonly CodexEngineEdit[];
  readonly apiEndpoints: readonly ApiEngineEdit[];
  /** None only while no engine is listed; Save asks for one once an engine is. */
  readonly officeDefault: EngineModel | null;
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
}

/** A model an engine's Models and prices lists; a Claude or Codex model's engine is null. */
export type PricedModel = Pick<OfferedModel, "engineId" | "model">;

/** A drafted engine with the id Save gives it. */
export type Drafted<Edit extends EngineEdit> = Edit & { readonly id: EngineId };

export type DraftedEndpoint = Drafted<ApiEngineEdit>;

/** The drafted engines with the ids Save gives them, of each kind in order. */
export interface DraftedEngines {
  readonly claudeCodeEngines: readonly Drafted<ClaudeCodeEngineEdit>[];
  readonly codexEngines: readonly Drafted<CodexEngineEdit>[];
  readonly apiEndpoints: readonly DraftedEndpoint[];
}

export function draftOf({
  engines,
  officeDefault,
  searchEndpoint,
  modelPrices,
  standInEngines,
  askBeforeSwitchAbove,
}: EngineSettings): EngineSettingsDraft {
  return {
    claudeCodeEngines: engines.flatMap((engine) =>
      engine.kind === "claude-code" ? [{ ...engine }] : [],
    ),
    codexEngines: engines.flatMap((engine) => (engine.kind === "codex" ? [{ ...engine }] : [])),
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
  };
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
 * engines, then the Codex engines), so an API endpoint's models read by name and a price typed before Save lands on
 * them.
 */
export function draftedEngines(draft: EngineSettingsDraft, saved: EngineSettings): DraftedEngines {
  const taken = new Set([
    ...saved.engines.map(({ id }) => id),
    ...[...draft.claudeCodeEngines, ...draft.codexEngines, ...draft.apiEndpoints].flatMap(
      ({ id }) => (id === undefined ? [] : [id]),
    ),
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
  const apiEndpoints = draft.apiEndpoints.map((endpoint) => ({
    ...endpoint,
    id: idOf(endpoint),
    name: endpoint.name.trim(),
  }));
  return { claudeCodeEngines, codexEngines, apiEndpoints };
}

/** Whether a model is one of the Codex models, whose price, as a Claude model's, has no engine. */
export function isCodexModel(model: string): boolean {
  return (CODEX_MODELS as readonly string[]).includes(model);
}

/**
 * The Claude models, as `saved` prices them: the models a Claude Code engine offers, those with no
 * engine that aren't Codex models.
 */
export function claudeModelsOf(saved: EngineSettings): readonly string[] {
  return saved.modelPrices
    .filter(({ engineId, model }) => engineId === null && !isCodexModel(model))
    .map(({ model }) => model);
}

/** The Codex models the draft offers: every one while a Codex engine is drafted, else none. */
export function codexModelsOf(draft: EngineSettingsDraft): readonly string[] {
  return draft.codexEngines.length === 0 ? [] : CODEX_MODELS;
}

/**
 * Every model the draft offers, as Save prices them: the Claude models as `saved` lists them, then
 * the Codex models while a Codex engine is drafted, then each drafted API endpoint's, each once;
 * one without an id yet is left out.
 */
export function offeredModelsOf(
  draft: EngineSettingsDraft,
  saved: EngineSettings,
): readonly PricedModel[] {
  const claudeModels = claudeModelsOf(saved).map((model) => ({ engineId: null, model }));
  const codexModels = codexModelsOf(draft).map((model) => ({ engineId: null, model }));
  const apiModels = draftedEngines(draft, saved).apiEndpoints.flatMap(({ id: engineId, models }) =>
    (engineId === "" ? [] : modelsOf({ models })).map((model) => ({ engineId, model })),
  );
  return [...claudeModels, ...codexModels, ...apiModels];
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
  return {
    engines: [
      ...draft.claudeCodeEngines,
      ...draft.codexEngines,
      ...draft.apiEndpoints.map(withOfferedDefaultModel),
    ],
    officeDefault: draft.officeDefault,
    searchEndpoint: draft.searchEndpoint,
    modelPrices,
    standInEngines: [...draft.standInEngines],
    askBeforeSwitchAbove,
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

/** An engine that may be listed as a Stand-in Engine, by its name. */
export interface StandInChoice {
  readonly id: EngineId;
  readonly name: string;
}

/**
 * The Stand-in Engines as listed, by name, and the engines "Add a stand-in" offers: those saved,
 * still drafted and not listed yet, since a new engine has no id until Save.
 */
export function standInsOf(
  draft: EngineSettingsDraft,
  saved: EngineSettings,
): { readonly listed: readonly StandInChoice[]; readonly addable: readonly StandInChoice[] } {
  const choices = officeDefaultChoicesOf(draft, saved).map(({ id, name }) => ({ id, name }));
  return {
    listed: draft.standInEngines.map(
      (id) => choices.find((choice) => choice.id === id) ?? { id, name: id },
    ),
    addable: choices.filter(({ id }) => !draft.standInEngines.includes(id)),
  };
}

/** The Stand-in Engines with the one at `index` moved by `by` places, kept within the list. */
export function withStandInMoved(
  standInEngines: readonly EngineId[],
  index: number,
  by: -1 | 1,
): readonly EngineId[] {
  const to = index + by;
  if (index < 0 || to < 0 || to >= standInEngines.length) return standInEngines;
  const moved = [...standInEngines];
  [moved[index], moved[to]] = [moved[to] as EngineId, moved[index] as EngineId];
  return moved;
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
 * A new Claude Code engine, on the first saved Claude Code engine's default model, else the first
 * Claude model.
 */
export function newClaudeCodeEngine(saved: EngineSettings): ClaudeCodeEngineEdit {
  const firstClaudeCode = saved.engines.find(({ kind }) => kind === "claude-code");
  return {
    name: "",
    kind: "claude-code",
    defaultModel: firstClaudeCode?.defaultModel ?? claudeModelsOf(saved)[0] ?? "",
    claudeCodeP: false,
  };
}

/**
 * A new Codex engine, on the first saved Codex engine's default model, else the first Codex model.
 */
export function newCodexEngine(saved: EngineSettings): CodexEngineEdit {
  const firstCodex = saved.engines.find(({ kind }) => kind === "codex");
  return { name: "", kind: "codex", defaultModel: firstCodex?.defaultModel ?? CODEX_MODELS[0] };
}

/** An engine the Office default may name, with the models it offers. */
export interface OfficeDefaultChoice {
  readonly id: EngineId;
  readonly name: string;
  readonly defaultModel: string;
  readonly models: readonly string[];
}

/**
 * The engines the Office default may name: those saved and still drafted, since a new engine's id
 * follows its name until Save.
 */
export function officeDefaultChoicesOf(
  draft: EngineSettingsDraft,
  saved: EngineSettings,
): readonly OfficeDefaultChoice[] {
  const claudeModels = claudeModelsOf(saved);
  return [
    ...draft.claudeCodeEngines.flatMap(({ id, name, defaultModel }) =>
      id === undefined ? [] : [{ id, name: name.trim(), defaultModel, models: claudeModels }],
    ),
    ...draft.codexEngines.flatMap(({ id, name, defaultModel }) =>
      id === undefined ? [] : [{ id, name: name.trim(), defaultModel, models: CODEX_MODELS }],
    ),
    ...draft.apiEndpoints.flatMap((endpoint) =>
      endpoint.id === undefined
        ? []
        : [
            {
              id: endpoint.id,
              name: endpoint.name.trim(),
              defaultModel: offeredDefaultModel(endpoint),
              models: modelsOf(endpoint),
            },
          ],
    ),
  ];
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
    apiEndpoints: draft.apiEndpoints,
    officeDefault: draft.officeDefault,
    searchEndpoint: draft.searchEndpoint,
    modelPrices: offeredModelsOf(draft, saved).map((offered) => priceTextIn(draft, offered)),
    standInEngines: draft.standInEngines,
    askBeforeSwitchAbove:
      switchSizeOf(draft.askBeforeSwitchAbove) ?? draft.askBeforeSwitchAbove.trim(),
  };
}

export const NEW_API_ENDPOINT: ApiEngineEdit = {
  name: "",
  kind: "openai-compatible-api",
  defaultModel: "",
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
