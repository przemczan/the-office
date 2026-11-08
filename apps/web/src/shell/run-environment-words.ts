import {
  runEnvironmentAnswerSchema,
  type ProjectRunEnvironment,
  type RunEnvironmentAnswer,
} from "@the-office/contracts";
import { TASK_STATE_NAMES } from "./work/work-words.ts";

/**
 * Asked once, while a Project's Run environment is "Not decided yet": in Add a Project, and at a
 * Task's Start for a Project added before it was asked or onboarded by Devops.
 */
export const RUN_ENVIRONMENT_QUESTION = "Run this Project's checks in a run environment?";

export const RUN_ENVIRONMENT_QUESTION_HINT =
  "In the containers its .devcontainer/ defines. Until you decide, they run on this computer.";

export const RUN_ENVIRONMENT_ANSWER_LABELS: Readonly<Record<RunEnvironmentAnswer, string>> = {
  yes: "Yes",
  no: "No",
  "decide-later": "Decide later",
};

/** In the order they are offered. */
export const RUN_ENVIRONMENT_ANSWERS: readonly RunEnvironmentAnswer[] =
  runEnvironmentAnswerSchema.options;

/** What On or Off now means for the Project's checks. */
export function settingChosenWords(saved: ProjectRunEnvironment, projectName: string): string {
  return saved.runEnvironment === "on"
    ? `Checks in ${projectName} run in its run environment.`
    : `Checks in ${projectName} run on this computer.`;
}

/** What Set up run environment did: turned On, or the set-up Task it added or found. */
export function setUpWords(saved: ProjectRunEnvironment, projectName: string): string {
  const task = saved.setUpTask;
  if (!task) return `Run environment is On: ${projectName}'s .devcontainer/ is valid.`;
  return `${task.title} is ${TASK_STATE_NAMES[task.state]}${task.state === "ready" ? ", waiting for your Start" : ""}.`;
}
