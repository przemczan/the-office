import { COPILOT_CLI_AUTO_MODEL, type Effort } from "@the-office/contracts";

/** The words for a model and its effort, wherever a Role card or a Stage names them. */

export const EFFORT_LABELS: Readonly<Record<Effort, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/** A model as a person reads it: "Opus 5.5" for a Claude model, "Auto" for Copilot CLI's, any other by its id. */
export function modelLabel(model: string): string {
  if (model === COPILOT_CLI_AUTO_MODEL) return "Auto";
  const match = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model);
  if (!match) return model;
  const [, family = "", major, minor] = match;
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`;
}
