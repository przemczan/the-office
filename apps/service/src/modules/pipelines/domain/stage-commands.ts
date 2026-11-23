import { problemOnStage, type StageProblem } from "./pipeline.js";
import { commandKeysOfStage, type Stage } from "./stage.js";

/**
 * A problem on each Stage but those whose keys are in `skipped` that names a command `commands` lacks, by key
 * (`commandKeysOfStage`), worded by `words` from the missing keys.
 */
export function missingCommandsOnStages(
  stages: readonly Stage[],
  commands: readonly { readonly key: string }[],
  skipped: ReadonlySet<string>,
  words: (missing: readonly string[]) => string,
): StageProblem[] {
  const keys = new Set(commands.map(({ key }) => key));
  return stages.flatMap((stage, stageIndex) => {
    if (skipped.has(stage.key)) return [];
    const missing = commandKeysOfStage(stage).filter((key) => !keys.has(key));
    return missing.length > 0 ? [problemOnStage(stage, stageIndex, words(missing))] : [];
  });
}

/** "command test-full", or "commands test-full and e2e". */
export function commandsWords(keys: readonly string[]): string {
  if (keys.length === 1) return `command ${keys[0]}`;
  return `commands ${keys.slice(0, -1).join(", ")} and ${keys.at(-1)}`;
}
