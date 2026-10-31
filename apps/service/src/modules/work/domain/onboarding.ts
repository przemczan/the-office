import type { Author } from "./author.js";
import type { Task } from "./task.js";
import { createTask, type TaskChange } from "./task-changes.js";
import { TaskCreated } from "./task-events.js";

/** The built-in Onboard Pipeline, keyed as Pipelines' library keys it (spec §2.3). */
export const ONBOARD_PIPELINE = "onboard";

export const ONBOARD_TASK_TITLE = "Onboard";

/** What the Onboard Task asks of Devops (spec §2.1 Defaults), written by The Office. */
export function onboardTaskPlan(projectName: string): string {
  return [
    `Make ${projectName} build and test in a fresh worktree of its base branch.`,
    "Run its install, build, lint and test commands there, fix what fails in the repository, and propose better commands where they are wrong.",
    "Ask before installing anything on the workstation.",
    "Verify then runs the Test command; Publish ships the fixes by the Project's publishing mode.",
  ].join("\n\n");
}

export const ONBOARD_TASK_DEFINITION_OF_DONE: readonly string[] = [
  "The install, build, lint and test commands pass in a fresh worktree of the base branch.",
  "Nothing was installed on the workstation without the user's approval.",
  "The fixes the repository needed are published by the Project's publishing mode.",
];

/** What The Office sets on a Project's Onboard Task besides its Project. */
export interface OnboardTaskSetting {
  readonly order: string;
  readonly createdBy: Author;
}

/**
 * A Project's Onboard Task: Ready on the Onboard Pipeline, its Plan and Definition of Done written
 * by The Office and confirmed, waiting for the user's Start like any Task.
 */
export function createOnboardTask(
  id: string,
  project: { readonly id: string; readonly name: string },
  setting: OnboardTaskSetting,
  createdAt: Date,
): TaskChange<TaskCreated> {
  const { task } = createTask(
    id,
    { title: ONBOARD_TASK_TITLE, projectId: project.id, priority: "normal" },
    {
      pipelineId: ONBOARD_PIPELINE,
      order: setting.order,
      originIdeaId: undefined,
      initiativeId: undefined,
      createdBy: setting.createdBy,
    },
    createdAt,
  );
  const onboardTask: Task = {
    ...task,
    state: "ready",
    plan: onboardTaskPlan(project.name),
    planConfirmed: true,
    filesToChange: [],
    definitionOfDone: ONBOARD_TASK_DEFINITION_OF_DONE,
    definitionOfDoneConfirmed: true,
    isOnboardTask: true,
  };
  return {
    task: onboardTask,
    event: new TaskCreated(onboardTask),
    stateChange: { from: undefined, to: "ready", at: createdAt, by: setting.createdBy },
  };
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
  if (!task.isOnboardTask || task.state === "dropped") return undefined;
  return {
    projectId: task.projectId,
    taskId: task.id,
    state: task.state === "done" ? "onboarded" : "onboarding",
  };
}
