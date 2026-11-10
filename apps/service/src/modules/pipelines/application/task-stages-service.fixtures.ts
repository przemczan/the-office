import { builtInPipelines } from "../domain/built-in-pipelines.js";
import type { Stage } from "../domain/stage.js";
import { gate } from "../domain/stage.fixtures.js";
import { StagesEditRefused } from "../domain/stages-edit-refused.js";

export function builtIn(id: string): readonly Stage[] {
  const pipeline = builtInPipelines.find((each) => each.id === id);
  if (!pipeline) throw new Error(`No built-in Pipeline ${id}.`);
  return pipeline.stages;
}

export const quickFix = builtIn("quick-fix");

export const withGate: readonly Stage[] = [
  ...quickFix.slice(0, -1),
  gate({ key: "look", name: "Look" }),
  ...quickFix.slice(-1),
];

export async function refusalOf(work: Promise<unknown>): Promise<readonly string[]> {
  const error: unknown = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof StagesEditRefused)) throw new Error("The edit wasn't refused.");
  return error.problems.map(({ text }) => text);
}
