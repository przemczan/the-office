import type { ConditionGroup } from "@the-office/contracts";
import type { StageCommandSource } from "../stage-commands.ts";
import { isGroup } from "./condition-edits.ts";

/**
 * The commands a condition's command test may run (docs/design/pipeline-flow.html, "The command
 * picker"): on a Project page that Project's, each with its line; in Settings, where an office-wide
 * Pipeline belongs to no Project, every key with the Projects that have it ("docs-changed · in
 * the-office"). A key the test names but no choice has stays listed, so its problem shows.
 */

export interface ConditionCommandChoice {
  readonly value: string;
  readonly label: string;
}

/** The "Choose a command…" choice, while a command test has none picked. */
export const NO_COMMAND = "";

export function conditionCommandChoices(
  current: string,
  source: StageCommandSource | undefined,
): ConditionCommandChoice[] {
  const offered = source === undefined ? [] : choicesOf(source);
  const kept =
    current === NO_COMMAND || offered.some(({ value }) => value === current)
      ? []
      : [{ value: current, label: current }];
  const none = current === NO_COMMAND ? [{ value: NO_COMMAND, label: "Choose a command…" }] : [];
  return [...none, ...kept, ...offered];
}

function choicesOf(source: StageCommandSource): ConditionCommandChoice[] {
  if (source.kind === "project") {
    return source.commands.map(({ key, commandLine }) => ({
      value: key,
      label: `${key} · ${commandLine === "" ? "not set" : commandLine}`,
    }));
  }
  const byKey = new Map<string, string[]>();
  for (const { name, commands } of source.projects) {
    for (const { key } of commands) byKey.set(key, [...(byKey.get(key) ?? []), name]);
  }
  return [...byKey]
    .toSorted(([one], [other]) => one.localeCompare(other))
    .map(([key, projects]) => ({ value: key, label: `${key} · in ${andJoined(projects)}` }));
}

/** Every command key the condition's tests run, each once, in the order they come. */
export function conditionCommandKeys(group: ConditionGroup): readonly string[] {
  const keys = group.tests.flatMap((item): readonly string[] => {
    if (isGroup(item)) return conditionCommandKeys(item);
    return item.kind === "command" && item.key !== NO_COMMAND ? [item.key] : [];
  });
  return [...new Set(keys)];
}

/** The spec's facts of a command test, under the condition that runs `keys` as `stageName` ends. */
export function commandNote(keys: readonly string[], stageName: string): string {
  return (
    `${andJoined(keys)} runs as ${stageName} ends, as a Script Stage's command runs: in the ` +
    "Task's worktree, with the Task's earlier Stage runs in the file OFFICE_STAGE_RUNS_FILE names. " +
    "It holds when it exits 0; one that can't run stops the walk and asks you. Its output is kept " +
    `on ${stageName}'s run.`
  );
}

function andJoined(parts: readonly string[]): string {
  const last = parts.at(-1) ?? "";
  return parts.length < 2 ? last : `${parts.slice(0, -1).join(", ")} and ${last}`;
}
