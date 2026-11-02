import type { EngineCaps, EngineId, UsageMeasure, UsageSettings } from "@the-office/contracts";
import { MEASURES } from "../../../shell/work/usage-estimate-words.ts";

export type CapKind = "fiveHour" | "sevenDay" | "dailyTokens" | "dailyDollars";

/**
 * One engine id's caps as their fields read while the user types; an empty field is a cap that is
 * off. `windows` is there exactly where the engine id has usage windows, as the service gives it.
 */
export interface CapsText {
  readonly engineId: EngineId;
  readonly windows?: { readonly fiveHour: string; readonly sevenDay: string };
  readonly dailyTokens: string;
  readonly dailyDollars: string;
}

export interface UsageSettingsDraft {
  /** In `MEASURES` order, so a draft compares with the saved settings whatever order they came in. */
  readonly measures: readonly UsageMeasure[];
  readonly caps: readonly CapsText[];
}

const textOf = (cap: number | null): string => (cap === null ? "" : String(cap));

export function draftOf(settings: UsageSettings): UsageSettingsDraft {
  return {
    measures: MEASURES.filter((measure) => settings.measures.includes(measure)),
    caps: settings.caps.map(({ engineId, windows, dailyTokens, dailyDollars }) => ({
      engineId,
      ...(windows && {
        windows: { fiveHour: textOf(windows.fiveHour), sevenDay: textOf(windows.sevenDay) },
      }),
      dailyTokens: textOf(dailyTokens),
      dailyDollars: textOf(dailyDollars),
    })),
  };
}

export function withMeasure(
  draft: UsageSettingsDraft,
  measure: UsageMeasure,
  ticked: boolean,
): UsageSettingsDraft {
  const others = draft.measures.filter((each) => each !== measure);
  const measures = ticked ? [...others, measure] : others;
  return { ...draft, measures: MEASURES.filter((each) => measures.includes(each)) };
}

export function capTextOf(caps: CapsText, kind: CapKind): string {
  switch (kind) {
    case "fiveHour":
    case "sevenDay":
      return caps.windows?.[kind] ?? "";
    case "dailyTokens":
    case "dailyDollars":
      return caps[kind];
  }
}

export function withCapText(
  draft: UsageSettingsDraft,
  engineId: EngineId,
  kind: CapKind,
  text: string,
): UsageSettingsDraft {
  return {
    ...draft,
    caps: draft.caps.map((caps) => {
      if (caps.engineId !== engineId) return caps;
      if (kind === "dailyTokens" || kind === "dailyDollars") return { ...caps, [kind]: text };
      return caps.windows ? { ...caps, windows: { ...caps.windows, [kind]: text } } : caps;
    }),
  };
}

/** Tokens may be typed with thousands separators, as the wait reasons write them. */
const numberIn = (text: string): number => Number(text.trim().replaceAll(",", ""));

/** What's wrong with a cap's field, or undefined; an empty field is a cap that is off. */
export function capFieldProblem(kind: CapKind, text: string): string | undefined {
  if (text.trim() === "") return undefined;
  const value = numberIn(text);
  switch (kind) {
    case "fiveHour":
    case "sevenDay":
      return Number.isInteger(value) && value >= 1 && value <= 100
        ? undefined
        : "Give a whole % from 1 to 100, or leave it empty for no cap.";
    case "dailyTokens":
      return Number.isInteger(value) && value > 0
        ? undefined
        : "Give a whole number of tokens above 0, or leave it empty for no cap.";
    case "dailyDollars":
      return Number.isFinite(value) && value > 0
        ? undefined
        : "Give dollars above 0, such as 20 or 7.5, or leave it empty for no cap.";
  }
}

const capOf = (text: string): number | null => (text.trim() === "" ? null : numberIn(text));

function engineCapsOf(caps: CapsText): EngineCaps {
  return {
    engineId: caps.engineId,
    ...(caps.windows && {
      windows: { fiveHour: capOf(caps.windows.fiveHour), sevenDay: capOf(caps.windows.sevenDay) },
    }),
    dailyTokens: capOf(caps.dailyTokens),
    dailyDollars: capOf(caps.dailyDollars),
  };
}

const CAP_KINDS: readonly CapKind[] = ["fiveHour", "sevenDay", "dailyTokens", "dailyDollars"];

/** The settings the draft gives, or undefined while a field has a problem. */
export function usageSettingsOf(draft: UsageSettingsDraft): UsageSettings | undefined {
  const problem = draft.caps.some((caps) =>
    CAP_KINDS.some((kind) => capFieldProblem(kind, capTextOf(caps, kind)) !== undefined),
  );
  return problem
    ? undefined
    : { measures: [...draft.measures], caps: draft.caps.map(engineCapsOf) };
}

/** Compared by what the fields give, so "200,000" against a saved 200000 is no change. */
export function draftChanged(draft: UsageSettingsDraft, saved: UsageSettings): boolean {
  const settings = usageSettingsOf(draft);
  return !settings || JSON.stringify(draftOf(settings)) !== JSON.stringify(draftOf(saved));
}
