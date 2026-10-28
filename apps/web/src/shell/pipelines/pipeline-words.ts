import type { Stage } from "@the-office/contracts";

/** The Stages in order, as the library's list shows them: "Implement → Tests → Publish". */
export function stagesLine({ stages }: { readonly stages: readonly Stage[] }): string {
  return stages.map(({ name }) => name).join(" → ");
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
