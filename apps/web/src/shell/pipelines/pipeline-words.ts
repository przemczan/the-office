import type { Role, Stage } from "@the-office/contracts";
import type { StageCommand } from "./stage-edits.ts";

export const STAGE_COMMAND_NAMES: Readonly<Record<StageCommand, string>> = {
  test: "Test",
  lint: "Lint",
  build: "Build",
  publish: "Publish",
};

/** The Stages in order, as the library's list shows them: "Implement → Tests → Publish". */
export function stagesLine({ stages }: { readonly stages: readonly Stage[] }): string {
  return stages.map(({ name }) => name).join(" → ");
}

/**
 * Who works the Stage, as its row says: the Role's person, its command (as the Project runs it, when
 * `commandLines` names one), or "waits for you" for a Gate.
 */
export function whoWorks(
  stage: Stage,
  roles: readonly Role[],
  commandLines?: Readonly<Record<StageCommand, string>>,
): string {
  if (stage.kind === "gate") return "waits for you";
  if (stage.kind === "script")
    return commandLines?.[stage.command] ?? STAGE_COMMAND_NAMES[stage.command];
  return roles.find(({ key }) => key === stage.role)?.card.name ?? "nobody yet";
}

/** Tokens in thousands, as a budget is typed and shown. */
export function thousands(tokens: number): number {
  return Math.round(tokens / 1000);
}

/** How a Stage fares in a change of a Pipeline's Stages, by its key. */
export interface StageChange {
  readonly name: string;
  readonly change: "added" | "removed" | "changed";
}

/** The Stages a change adds, removes or rewrites, by key, in the order the new Stages have them. */
export function stageChanges(from: readonly Stage[], to: readonly Stage[]): StageChange[] {
  const before = new Map(from.map((stage) => [stage.key, stage]));
  const kept = new Set(to.map(({ key }) => key));
  return [
    ...to.flatMap((stage): StageChange[] => {
      const was = before.get(stage.key);
      if (!was) return [{ name: stage.name, change: "added" }];
      return sameStage(was, stage) ? [] : [{ name: stage.name, change: "changed" }];
    }),
    ...from
      .filter(({ key }) => !kept.has(key))
      .map(({ name }): StageChange => ({ name, change: "removed" })),
  ];
}

function sameStage(one: Stage, other: Stage): boolean {
  return JSON.stringify(one, sortedKeys) === JSON.stringify(other, sortedKeys);
}

/** Fields in one order, so two Stages alike read alike whatever order their fields came in. */
function sortedKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).toSorted(([one], [other]) => one.localeCompare(other)),
  );
}
