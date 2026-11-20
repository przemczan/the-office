import { PROPOSE_TEST_TARGETS_TOOL } from "../../conversations/index.js";
import type { Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import type { TaskCreated } from "./task-events.js";
import { createTaskMadeFor, type MadeTaskSetting } from "./task-made-for.js";

/** The built-in "Set up test targets" Pipeline, keyed as Pipelines' library keys it. */
export const SET_UP_TEST_TARGETS_PIPELINE = "set-up-test-targets";

export const TEST_TARGETS_SET_UP_TITLE = "Set up test targets";

/** What the set-up Task asks of Devops, written by The Office (spec §2.12, "Set up test targets"). */
export function testTargetsSetUpPlan(projectName: string): string {
  return [
    `Propose the test targets of ${projectName}: what can be launched on an Initiative's branch to try the work, each Hosted (an app started in the run environment, with the port it listens on) or Build to install (a build whose output files are offered to install).`,
    "Read the repository to find them: its manifests and their scripts, its Gradle files and wrapper, its own start and build scripts, and the services of .devcontainer/. Change no file: test targets are settings kept in The Office, never in the repository.",
    "Name only the Project's own entry points: a file in the repository run with its arguments, a script the package manifest lists, a Gradle task run through the repository's wrapper, or a service of .devcontainer/ (Hosted only). Never a command line, inline shell or a program outside the repository.",
    `End with ${PROPOSE_TEST_TARGETS_TOOL}, giving every target at once. A value the user set is changed only when you name it on purpose. A Secret variable goes by name alone: the user types its value on the Project page. The user applies the Proposal from its card.`,
  ].join("\n\n");
}

/** Devops reports it in the Stage, which ends the Task: nothing ships, so each must hold then. */
export const TEST_TARGETS_SET_UP_DEFINITION_OF_DONE: readonly string[] = [
  `A ${PROPOSE_TEST_TARGETS_TOOL} Proposal holds the Project's test targets, each naming one of the repository's own entry points.`,
  "No file in the worktree is changed.",
];

/**
 * A Project's "Set up test targets" Task: Ready on the "Set up test targets" Pipeline, its Plan and
 * Definition of Done written by The Office and confirmed.
 */
export function createTestTargetsSetUpTask(
  id: string,
  project: { readonly id: string; readonly name: string },
  setting: MadeTaskSetting,
  createdAt: Date,
): TaskChange<TaskCreated> {
  return createTaskMadeFor(
    id,
    project.id,
    {
      madeFor: "test-targets-setup",
      title: TEST_TARGETS_SET_UP_TITLE,
      pipelineId: SET_UP_TEST_TARGETS_PIPELINE,
      plan: testTargetsSetUpPlan(project.name),
      definitionOfDone: TEST_TARGETS_SET_UP_DEFINITION_OF_DONE,
    },
    setting,
    createdAt,
  );
}

/** Whether the Task is its Project's "Set up test targets" Task and neither Done nor Dropped. */
export function isOpenTestTargetsSetUp(task: Task): boolean {
  return task.madeFor === "test-targets-setup" && task.state !== "done" && task.state !== "dropped";
}
