import {
  type EngineUsageEstimate,
  type UsageEstimate,
  type UsageEstimateBasis,
  type UsageMeasure,
} from "@the-office/contracts";
import { tokensShort } from "../conversation/context-words.ts";
import { engineIdLabel } from "../engine-words.ts";

/** The measures in the order Settings › Office limits ticks them and an estimate gives them. */
export const MEASURES = [
  "tokens",
  "fiveHourWindow",
  "sevenDayWindow",
  "cost",
] as const satisfies readonly UsageMeasure[];

export const MEASURE_LABELS: Readonly<Record<UsageMeasure, string>> = {
  tokens: "Tokens",
  fiveHourWindow: "5-hour window",
  sevenDayWindow: "7-day window",
  cost: "Cost",
};

/**
 * A Usage estimate as one line: each ticked measure, per engine id when the Task spends on several,
 * then where it came from (spec §2.1, "Usage estimates"): "Expected: 120k tokens · 6% of the
 * 5-hour window, from the history of 4 done Tasks."
 */
export function usageEstimateWords({ basis, engines }: UsageEstimate): string {
  const [only] = engines;
  if (basis.source === "none" || !only) {
    return "No estimate: fewer than 3 done Tasks to learn from, and no Planner's estimate.";
  }
  const perEngine =
    engines.length === 1
      ? measuresWords(only)
      : engines
          .map((engine) => `${engineIdLabel(engine.engineId)}: ${measuresWords(engine)}`)
          .join("; ");
  return `Expected: ${perEngine}, ${basisWords(basis)}`;
}

function measuresWords(engine: EngineUsageEstimate): string {
  return MEASURES.filter((measure) => engine[measure] !== undefined)
    .map((measure) => measureWords(measure, engine))
    .join(" · ");
}

function measureWords(measure: UsageMeasure, engine: EngineUsageEstimate): string {
  switch (measure) {
    case "tokens":
      return `${tokensShort(engine.tokens ?? 0)} tokens`;
    case "fiveHourWindow":
      return windowWords(engine.fiveHourWindow, "5-hour window");
    case "sevenDayWindow":
      return windowWords(engine.sevenDayWindow, "7-day window");
    case "cost":
      return engine.cost == null ? "no cost" : dollarsWords(engine.cost);
  }
}

function windowWords(percent: number | null | undefined, window: string): string {
  if (percent == null) return `no estimate of the ${window}`;
  const shown = percent < 10 ? percent.toFixed(1).replace(/\.0$/, "") : String(Math.round(percent));
  return `${shown}% of the ${window}`;
}

function dollarsWords(dollars: number): string {
  if (dollars > 0 && dollars < 0.01) return "under $0.01";
  return `$${dollars.toFixed(2)}`;
}

function basisWords(basis: Exclude<UsageEstimateBasis, { source: "none" }>): string {
  if (basis.source === "planner") return "from the Planner's estimate.";
  return `from the history of ${basis.tasks} done ${basis.tasks === 1 ? "Task" : "Tasks"}.`;
}
