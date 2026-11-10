import type { Stage } from "./stage.js";
import { agentStage, scriptStage } from "./stage.fixtures.js";
import { aStageRun } from "./stage-run.fixtures.js";
import type { RoleFilling } from "./stage-staffing.js";
import { makeTaskStages, type TaskStages } from "./task-stages.js";

// What task-stages.test.ts and task-stages.full.test.ts share: a Task's copy of a Pipeline and its Roles.

export const implement = agentStage();
export const tests = scriptStage({ onFailure: { goBackTo: "implement", rounds: 2 } });
export const review = agentStage({ key: "review", name: "Review & fix" });
export const publish = scriptStage({ key: "publish", name: "Publish", command: "publish" });
export const stages: readonly Stage[] = [implement, tests, review, publish];

export const own: TaskStages = makeTaskStages(
  "task-1",
  { id: "full", name: "Full", description: "Most work.", stages },
  new Date(0),
).taskStages;

export const roles = new Map<string, RoleFilling>([
  ["developer", { title: "Developer", person: { name: "Ada", taskLimit: 2 } }],
  ["cto", { title: "CTO", person: { name: "Nina", taskLimit: "none" } }],
]);

export function ranOnce(stageKey: string, number = 1) {
  return aStageRun({ id: `run-${number}`, stageKey, number });
}
