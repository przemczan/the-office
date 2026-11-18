import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import type { Git } from "../ports/git.js";
import type { ProjectCommandRunner } from "./project-command-runner.js";
import { TaskCommandRunner } from "./task-command-runner.js";
import { TaskRunEnvironments } from "./task-run-environments.js";

/**
 * A TaskCommandRunner over the commands and git given, with run environments only when a test
 * gives them: enough for a Project whose Run environment setting isn't On. The Office data
 * directory only names the Stage runs' folder, which nothing here writes.
 */
export function taskCommandsOver(
  commands: ProjectCommandRunner,
  git: Git,
  runEnvironments = new TaskRunEnvironments(),
  officeData = new OfficeDataDirectory(join(tmpdir(), "the-office-task-commands")),
): TaskCommandRunner {
  return new TaskCommandRunner(commands, runEnvironments, git, officeData);
}
