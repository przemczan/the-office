import type { Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import type { TaskCreated } from "./task-events.js";
import { createTaskMadeFor, type MadeTaskSetting } from "./task-made-for.js";

/** The built-in Onboard Pipeline, keyed as Pipelines' library keys it (spec §2.3). */
export const ONBOARD_PIPELINE = "onboard";

export const ONBOARD_TASK_TITLE = "Onboard";

/** What the Onboard Task asks of Devops (spec §2.1 Defaults), written by The Office. */
export function onboardTaskPlan(projectName: string): string {
  return [
    `Make ${projectName} build and test in a fresh worktree of its base branch.`,
    "Run its install, build, lint and test commands there, fix what fails in the repository, and propose better commands where they are wrong.",
    "Ask before installing anything on the workstation.",
    "Verify then runs the Test command; Publish ships the fixes by the Project's publishing mode. A repository that needs no fixes is onboarded as it is: report the Definition of Done met.",
  ].join("\n\n");
}

/**
 * Devops reports it in the Onboard Stage, before Publish runs, so each statement must hold then,
 * the last one for a repository that needed no fixes too (task 31's live run).
 */
export const ONBOARD_TASK_DEFINITION_OF_DONE: readonly string[] = [
  "The install, build, lint and test commands pass in a fresh worktree of the base branch.",
  "Nothing was installed on the workstation without the user's approval.",
  "The fixes the repository needed, if any, are made in the worktree for Publish to ship by the Project's publishing mode; a repository that needed none meets this as it is.",
];

/**
 * A Project's Onboard Task: Ready on the Onboard Pipeline, its Plan and Definition of Done written
 * by The Office and confirmed, waiting for the user's Start like any Task.
 */
export function createOnboardTask(
  id: string,
  project: { readonly id: string; readonly name: string },
  setting: MadeTaskSetting,
  createdAt: Date,
): TaskChange<TaskCreated> {
  return createTaskMadeFor(
    id,
    project.id,
    {
      madeFor: "onboard",
      title: ONBOARD_TASK_TITLE,
      pipelineId: ONBOARD_PIPELINE,
      plan: onboardTaskPlan(project.name),
      definitionOfDone: ONBOARD_TASK_DEFINITION_OF_DONE,
    },
    setting,
    createdAt,
  );
}

/** A Project's onboarding, read from its Onboard Task alone; a Project without one has none. */
export type OnboardingState = "onboarding" | "onboarded";

export interface ProjectOnboarding {
  readonly projectId: string;
  readonly taskId: string;
  readonly state: OnboardingState;
}

/** Undefined for a Task that isn't an Onboard Task, and for a dropped one: no onboarding then. */
export function projectOnboardingOf(task: Task): ProjectOnboarding | undefined {
  if (task.madeFor !== "onboard" || task.state === "dropped") return undefined;
  return {
    projectId: task.projectId,
    taskId: task.id,
    state: task.state === "done" ? "onboarded" : "onboarding",
  };
}
