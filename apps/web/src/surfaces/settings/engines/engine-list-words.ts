import type {
  ApiEngineEdit,
  EngineAccount,
  EngineEdit,
  EngineSettings,
} from "@the-office/contracts";
import { modelLabel } from "../../../shell/engine-words.ts";
import {
  draftedEngines,
  isCodexModel,
  modelsOf,
  offeredModelsOf,
  priceTextIn,
  switchSizeOf,
  type DraftedEngines,
  type EngineSettingsDraft,
  type PricedModel,
} from "./engine-settings-draft.ts";
import { priceOf } from "./model-price-fields.ts";

/**
 * The engine Settings › Engines shows: its kind and its place among the draft's engines of that
 * kind, since one added since the last Save has no id yet.
 */
export interface EngineSelection {
  readonly kind: EngineEdit["kind"];
  readonly index: number;
}

/** A tab of an engine's detail. */
export type EngineTab = "settings" | "account" | "prices";

export const ENGINE_KIND_LABELS: Readonly<Record<EngineEdit["kind"], string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "copilot-cli": "Copilot CLI",
  "openai-compatible-api": "API endpoint",
};

/** Each kind's icon, in the list's rows, in "Add an engine" and on the engine's card. */
export const ENGINE_KIND_ICONS: Readonly<Record<EngineEdit["kind"], string>> = {
  "claude-code": "terminal",
  codex: "bot",
  "copilot-cli": "github",
  "openai-compatible-api": "server",
};

/**
 * Every engine of the draft, the Claude Code engines first, then the Codex engines, then the
 * Copilot CLI engines, as Save sends them.
 */
export function engineSelectionsOf(draft: EngineSettingsDraft): readonly EngineSelection[] {
  return [
    ...draft.claudeCodeEngines.map((_engine, index) => ({ kind: "claude-code" as const, index })),
    ...draft.codexEngines.map((_engine, index) => ({ kind: "codex" as const, index })),
    ...draft.copilotCliEngines.map((_engine, index) => ({
      kind: "copilot-cli" as const,
      index,
    })),
    ...draft.apiEndpoints.map((_endpoint, index) => ({
      kind: "openai-compatible-api" as const,
      index,
    })),
  ];
}

/** The engine at `selection`, if the draft still has it. */
export function engineAt(
  draft: EngineSettingsDraft,
  { kind, index }: EngineSelection,
): EngineEdit | undefined {
  switch (kind) {
    case "claude-code":
      return draft.claudeCodeEngines[index];
    case "codex":
      return draft.codexEngines[index];
    case "copilot-cli":
      return draft.copilotCliEngines[index];
    case "openai-compatible-api":
      return draft.apiEndpoints[index];
  }
}

/** The id Save gives the engine at `selection`: empty while a new one has no name. */
export function draftedIdAt(drafted: DraftedEngines, { kind, index }: EngineSelection): string {
  switch (kind) {
    case "claude-code":
      return drafted.claudeCodeEngines[index]?.id ?? "";
    case "codex":
      return drafted.codexEngines[index]?.id ?? "";
    case "copilot-cli":
      return drafted.copilotCliEngines[index]?.id ?? "";
    case "openai-compatible-api":
      return drafted.apiEndpoints[index]?.id ?? "";
  }
}

/**
 * The draft with the engine at `selection` changed to `edit`; unchanged when `edit` is of another
 * kind.
 */
export function withEngineChanged(
  draft: EngineSettingsDraft,
  { kind, index }: EngineSelection,
  edit: EngineEdit,
): EngineSettingsDraft {
  const replaced = <Edit>(engines: readonly Edit[], changed: Edit): readonly Edit[] =>
    engines.map((kept, at) => (at === index ? changed : kept));
  if (edit.kind !== kind) return draft;
  switch (edit.kind) {
    case "claude-code":
      return { ...draft, claudeCodeEngines: replaced(draft.claudeCodeEngines, edit) };
    case "codex":
      return { ...draft, codexEngines: replaced(draft.codexEngines, edit) };
    case "copilot-cli":
      return { ...draft, copilotCliEngines: replaced(draft.copilotCliEngines, edit) };
    case "openai-compatible-api":
      return { ...draft, apiEndpoints: replaced(draft.apiEndpoints, edit) };
  }
}

/** The draft without the engine at `selection`. */
export function withoutEngine(
  draft: EngineSettingsDraft,
  { kind, index }: EngineSelection,
): EngineSettingsDraft {
  const kept = <Edit>(engines: readonly Edit[]): readonly Edit[] =>
    engines.filter((_engine, at) => at !== index);
  switch (kind) {
    case "claude-code":
      return { ...draft, claudeCodeEngines: kept(draft.claudeCodeEngines) };
    case "codex":
      return { ...draft, codexEngines: kept(draft.codexEngines) };
    case "copilot-cli":
      return { ...draft, copilotCliEngines: kept(draft.copilotCliEngines) };
    case "openai-compatible-api":
      return { ...draft, apiEndpoints: kept(draft.apiEndpoints) };
  }
}

/**
 * The engine shown: the one selected while the draft has it, else its neighbour of the same kind,
 * else the first engine; none while no engine is listed. A removal or a Discard so never leaves an
 * engine shown that has gone.
 */
export function shownSelection(
  draft: EngineSettingsDraft,
  selection: EngineSelection | undefined,
): EngineSelection | undefined {
  if (selection) {
    const ofKind = engineSelectionsOf(draft).filter(({ kind }) => kind === selection.kind);
    const neighbour = ofKind[Math.min(selection.index, ofKind.length - 1)];
    if (neighbour) return neighbour;
  }
  return engineSelectionsOf(draft)[0];
}

export function sameSelection(a: EngineSelection | undefined, b: EngineSelection): boolean {
  return a?.kind === b.kind && a.index === b.index;
}

/** The tabs of an engine's detail: an API endpoint has no account to sign in. */
export function engineTabsOf(kind: EngineEdit["kind"]): readonly EngineTab[] {
  return kind === "openai-compatible-api"
    ? ["settings", "prices"]
    : ["settings", "account", "prices"];
}

export const ENGINE_TAB_LABELS: Readonly<Record<EngineTab, string>> = {
  settings: "Settings",
  account: "Account",
  prices: "Models and prices",
};

/** What an engine is called before it has a name of its own. */
export function engineCalled({ name, kind }: EngineEdit): string {
  if (name.trim() !== "") return name.trim();
  switch (kind) {
    case "claude-code":
      return "the new Claude Code engine";
    case "codex":
      return "the new Codex engine";
    case "copilot-cli":
      return "the new Copilot CLI engine";
    case "openai-compatible-api":
      return "the new API endpoint";
  }
}

/**
 * A Claude Code engine's line in the list: signed in or out, then its default model. One not saved
 * has no folder to sign in yet; while its account is read, the model alone.
 */
export function claudeCodeEngineSummary(
  defaultModel: string,
  account: EngineAccount | "not-saved" | undefined,
): string {
  return signedInEngineSummary(defaultModel, account);
}

/**
 * A Codex engine's line in the list, as a Claude Code engine's: signed in or out, by ChatGPT or an
 * API key alike, then its default model.
 */
export function codexEngineSummary(
  defaultModel: string,
  account: EngineAccount | "not-saved" | undefined,
): string {
  return signedInEngineSummary(defaultModel, account);
}

function signedInEngineSummary(
  defaultModel: string,
  account: EngineAccount | "not-saved" | undefined,
): string {
  const model = modelLabel(defaultModel);
  if (account === undefined) return model;
  if (account === "not-saved") return `Signed in once saved · ${model}`;
  return `${account.signedIn ? "Signed in" : "Signed out"} · ${model}`;
}

/**
 * A Copilot CLI engine's line in the list, as a Codex engine's: signed in or out, then its default
 * model (Auto).
 */
export function copilotCliEngineSummary(
  defaultModel: string,
  account: EngineAccount | "not-saved" | undefined,
): string {
  return signedInEngineSummary(defaultModel, account);
}

/** An API endpoint's line in the list: how many models it offers. */
export function apiEndpointSummary(endpoint: Pick<ApiEngineEdit, "models">): string {
  const count = modelsOf(endpoint).length;
  if (count === 0) return "No model yet";
  return count === 1 ? "1 model" : `${count} models`;
}

/**
 * The models priced in an engine's Models and prices: a Claude Code engine's are the Claude models,
 * shared by every Claude Code engine; a Codex engine's the Codex models, shared by every Codex
 * engine; a Copilot CLI engine's or an API endpoint's are its own, by the id Save gives it, none
 * while it has no name to give one.
 */
export function pricedModelsAt(
  draft: EngineSettingsDraft,
  saved: EngineSettings,
  { kind, index }: EngineSelection,
): readonly PricedModel[] {
  const offered = offeredModelsOf(draft, saved);
  if (kind === "claude-code") {
    return offered.filter(({ engineId, model }) => engineId === null && !isCodexModel(model));
  }
  if (kind === "codex") {
    return offered.filter(({ engineId, model }) => engineId === null && isCodexModel(model));
  }
  const drafted = draftedEngines(draft, saved);
  const id =
    (kind === "copilot-cli" ? drafted.copilotCliEngines : drafted.apiEndpoints)[index]?.id ?? "";
  return id === "" ? [] : offered.filter(({ engineId }) => engineId === id);
}

/** Whether a price of the engine's Models and prices doesn't read as one, which holds Save. */
export function pricesHoldSave(
  draft: EngineSettingsDraft,
  saved: EngineSettings,
  selection: EngineSelection,
): boolean {
  return pricedModelsAt(draft, saved, selection).some(
    (model) => priceOf(priceTextIn(draft, model)) === undefined,
  );
}

/** What the engine's warning mark says, or undefined while nothing about it needs fixing. */
export function engineProblem(
  draft: EngineSettingsDraft,
  saved: EngineSettings,
  selection: EngineSelection,
): string | undefined {
  if (pricesHoldSave(draft, saved, selection)) {
    switch (selection.kind) {
      case "claude-code":
        return "A Claude model's price needs fixing";
      case "codex":
        return "A Codex model's price needs fixing";
      case "copilot-cli":
        return "A model's price needs fixing";
      case "openai-compatible-api":
        return "A model's price needs fixing";
    }
  }
  const engine = engineAt(draft, selection);
  if (engine?.kind === "openai-compatible-api" && modelsOf(engine).length === 0) {
    return "It offers no model yet";
  }
  return undefined;
}

/**
 * The first engine whose prices hold Save, and what the Save bar says of it. A Claude model's price
 * still holds Save once no Claude Code engine is listed to show it: then the line alone.
 */
export function saveHeldBy(
  draft: EngineSettingsDraft,
  saved: EngineSettings,
): { readonly selection: EngineSelection | undefined; readonly line: string } | undefined {
  for (const selection of engineSelectionsOf(draft)) {
    const engine = engineAt(draft, selection);
    if (engine && pricesHoldSave(draft, saved, selection)) {
      return {
        selection,
        line: `A price under Models and prices of ${engineCalled(engine)} needs fixing before Save.`,
      };
    }
  }
  if (pricesHoldSave(draft, saved, { kind: "claude-code", index: 0 })) {
    return {
      selection: undefined,
      line: "A Claude model's price needs fixing before Save: add a Claude Code engine to show it, or Discard.",
    };
  }
  if (switchSizeOf(draft.askBeforeSwitchAbove) === undefined) {
    return {
      selection: undefined,
      line: "The context size under Stand-in Engines needs fixing before Save.",
    };
  }
  return undefined;
}
