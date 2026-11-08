import type { ProjectCommandRunner } from "./project-command-runner.js";
import { TaskCommandRunner } from "./task-command-runner.js";
import { TaskRunEnvironments } from "./task-run-environments.js";

/**
 * A TaskCommandRunner over the commands given, with run environments only when a test gives them:
 * enough for a Project whose Run environment setting isn't On.
 */
export function taskCommandsOver(
  commands: ProjectCommandRunner,
  runEnvironments = new TaskRunEnvironments(),
): TaskCommandRunner {
  return new TaskCommandRunner(commands, runEnvironments);
}
