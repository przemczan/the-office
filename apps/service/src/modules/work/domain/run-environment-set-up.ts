import { WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL } from "../../engine/index.domain.js";
import type { Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import type { TaskCreated } from "./task-events.js";
import { createTaskMadeFor, type MadeTaskSetting } from "./task-made-for.js";

/** The built-in "Set up run environment" Pipeline, keyed as Pipelines' library keys it. */
export const SET_UP_RUN_ENVIRONMENT_PIPELINE = "set-up-run-environment";

export const RUN_ENVIRONMENT_SET_UP_TITLE = "Set up the run environment";

/** What the set-up Task asks of Devops, written by The Office. */
export function runEnvironmentSetUpPlan(projectName: string): string {
  return [
    `Write the run environment definition of ${projectName}: .devcontainer/devcontainer.json and a compose file beside it, with the service the checks run in and one for each service the tests need (a database, a cache and so on), from the repository's manifests and its install, build, lint and test commands.`,
    `Write the files with ${WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL}, giving each whole: Write and Edit can't reach .devcontainer/. It checks the definition as The Office reads it and writes the files only when it is valid; otherwise it answers every problem found, for you to fix and write again.`,
    "The Office runs the checks in the service devcontainer.json names, with the worktree mounted at its own path, and sets every service's limits itself. So a service publishes no ports, mounts no folder of this computer (named volumes only), and sets no limits, fixed container name or privileged mode; a compose file reads nothing from this computer's environment (no ${NAME}, write $$ for a $; no variable left without a value; no env_file, secrets, configs or include); and the checks' service is built from .devcontainer/ alone, its build context and Dockerfile there, since its image is keyed by that folder and the Install inputs. devcontainer.json sets only name, dockerComposeFile, service, runServices, workspaceFolder, overrideCommand, shutdownAction, remoteUser, containerUser and customizations.",
    "Verify then runs the Test command; Publish ships the definition by the Project's publishing mode. Once this Task is Done with a valid definition on its branch, the Project's Run environment turns On.",
  ].join("\n\n");
}

/** Devops reports it in the Set up Stage, before Publish runs, so each must hold then. */
export const RUN_ENVIRONMENT_SET_UP_DEFINITION_OF_DONE: readonly string[] = [
  ".devcontainer/devcontainer.json names a compose file in .devcontainer/ and the service the checks run in.",
  "The compose file holds the services the Project's tests need, with no published ports, no folders of this computer mounted, no limits, no fixed container names and no privileged mode.",
  "The definition is committed in the worktree for Publish to ship by the Project's publishing mode.",
];

/**
 * A Project's "Set up the run environment" Task, an Off-board Task: Ready on the "Set up run
 * environment" Pipeline, its Plan and Definition of Done written by The Office and confirmed, for
 * `OffBoardTasks` to start at once.
 */
export function createRunEnvironmentSetUpTask(
  id: string,
  project: { readonly id: string; readonly name: string },
  setting: MadeTaskSetting,
  createdAt: Date,
): TaskChange<TaskCreated> {
  return createTaskMadeFor(
    id,
    project.id,
    {
      madeFor: "run-environment-setup",
      title: RUN_ENVIRONMENT_SET_UP_TITLE,
      pipelineId: SET_UP_RUN_ENVIRONMENT_PIPELINE,
      plan: runEnvironmentSetUpPlan(project.name),
      definitionOfDone: RUN_ENVIRONMENT_SET_UP_DEFINITION_OF_DONE,
    },
    setting,
    createdAt,
  );
}

/** Whether the Task is its Project's set-up Task and neither Done nor Dropped. */
export function isOpenRunEnvironmentSetUp(task: Task): boolean {
  return (
    task.madeFor === "run-environment-setup" && task.state !== "done" && task.state !== "dropped"
  );
}
