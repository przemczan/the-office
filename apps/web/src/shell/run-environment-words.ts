import type {
  ProjectRunEnvironment,
  RunEnvironmentAnswer,
  RunEnvironmentSetUpAnswer,
} from "@the-office/contracts";
import { offBoardStartWords } from "./off-board-task-words.ts";

/** Asked in Add a Project; No, picked at first, leaves Run environment Off. */
export const RUN_ENVIRONMENT_QUESTION = "Run this Project's checks in a run environment?";

export const RUN_ENVIRONMENT_QUESTION_HINT =
  "In the containers the .devcontainer/ on each Task's branch defines. With No they run on this computer; you can switch it on the Project's page at any time.";

export const RUN_ENVIRONMENT_ANSWER_LABELS: Readonly<Record<RunEnvironmentAnswer, string>> = {
  no: "No",
  yes: "Yes",
};

/** In the order they are offered: No first, as it is picked at first. */
export const RUN_ENVIRONMENT_ANSWERS: readonly RunEnvironmentAnswer[] = ["no", "yes"];

/** What On or Off now means for the Project's checks. */
export function settingChosenWords(saved: ProjectRunEnvironment, projectName: string): string {
  return saved.runEnvironment === "on"
    ? `Checks in ${projectName} run in its run environment.`
    : `Checks in ${projectName} run on this computer.`;
}

/**
 * What Set up run environment did: turned On at once, or started (or found in flight) its
 * Off-board Task. Undefined when it was refused, which shows where it was asked instead.
 */
export function setUpWords(
  answer: RunEnvironmentSetUpAnswer,
  projectName: string,
): string | undefined {
  if (!answer.start) return `Run environment is On: ${projectName}'s .devcontainer/ is valid.`;
  return offBoardStartWords(answer.start, projectName);
}
