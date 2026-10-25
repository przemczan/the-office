import {
  projectCommandKeySchema,
  type Pipeline,
  type ProjectCommandKey,
  type ProjectMarkColour,
  type PublishingMode,
} from "@the-office/contracts";

/** In the order a fresh worktree runs them. */
export const COMMAND_KEYS: readonly ProjectCommandKey[] = projectCommandKeySchema.options;

export const COMMAND_LABELS: Readonly<Record<ProjectCommandKey, string>> = {
  install: "Install",
  build: "Build",
  lint: "Lint",
  test: "Test",
};

export const MARK_COLOUR_LABELS: Readonly<Record<ProjectMarkColour, string>> = {
  teal: "Teal",
  violet: "Violet",
  gray: "Gray",
  ink: "Ink",
};

export function publishingLabel(mode: PublishingMode, baseBranch: string): string {
  return mode === "merge" ? `Merge into ${baseBranch}` : "Push and open a pull request";
}

/** "Implement → Tests → Publish" */
export function stagesLine(pipeline: Pipeline): string {
  return pipeline.stages.map((stage) => stage.name).join(" → ");
}

/** Up to three letters or digits from the name's words, as a mark's label: "Admin panel" → "AP". */
export function markLabelFor(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const initials =
    words.length > 1 ? words.map((word) => word[0]).join("") : (words[0]?.slice(0, 2) ?? "");
  return initials.slice(0, 3).toUpperCase();
}
