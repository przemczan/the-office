import { join } from "node:path";
import { OfficeDataDirectory } from "../../platform/office-data/office-data-directory.js";
import { officeIdentityForTests } from "../../platform/git-identity/office-identity.fixtures.js";
import { CommandLineGit } from "./adapters/git/command-line-git.js";
import { RepositoryLocks } from "./adapters/git/repository-locks.js";
import {
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
} from "./adapters/git/temporary-repository.fixtures.js";
import { ShellCommandRunner } from "./adapters/shell/shell-command-runner.js";
import type { Project } from "./domain/project.js";
import { aProject } from "./domain/project.fixtures.js";
import { ProjectCommandRunner } from "./application/project-command-runner.js";
import { taskCommandsOver } from "./application/task-command-runner.fixtures.js";
import { ScriptedTaskRunEnvironments } from "./application/task-run-environments.fixtures.js";
import { Worktrees } from "./application/worktrees.js";

/** An install that adds one "x" to the log, so a test can count installs. */
export const COUNTING_INSTALL = `node -e "require('fs').appendFileSync(process.env.INSTALL_LOG, 'x')"`;

/**
 * Worktrees with real git and real commands on a temporary repository whose main tracks its
 * origin's.
 */
export async function worktreesOnATemporaryRepository(): Promise<{
  repository: TemporaryRepository;
  worktrees: Worktrees;
  installLog: string;
  project: Project;
  runEnvironments: ScriptedTaskRunEnvironments;
}> {
  const repository = await createTemporaryRepository();
  gitIn(repository.path, "fetch", "--quiet", "origin");
  gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
  const installLog = join(repository.folder, "installs.log");
  const commands = new ProjectCommandRunner(new ShellCommandRunner());
  const runEnvironments = new ScriptedTaskRunEnvironments(new ShellCommandRunner());
  const worktrees = new Worktrees(
    new CommandLineGit(new RepositoryLocks(), officeIdentityForTests()),
    commands,
    taskCommandsOver(commands, runEnvironments.registry()),
    new OfficeDataDirectory(join(repository.folder, "office-data")),
  );
  const project = aProject({
    path: repository.path,
    commands: { ...aProject().commands, install: COUNTING_INSTALL },
    installInputs: ["package-lock.json"],
    environment: {
      set: [{ name: "INSTALL_LOG", value: installLog, secret: false }],
      unset: [],
      prependPath: [],
    },
  });
  return { repository, worktrees, installLog, project, runEnvironments };
}
