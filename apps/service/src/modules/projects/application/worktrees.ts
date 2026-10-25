import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../platform/os/current-operating-system.js";
import type { CommandRun } from "../domain/command-run.js";
import type { Project } from "../domain/project.js";
import type { ProjectEnvironment } from "../domain/project-environment.js";
import { Git, type GitVariables, type Upstream, type WorktreeCheckout } from "../ports/git.js";
import { ProjectCommandRunner } from "./project-command-runner.js";

/** Short, as worktree paths count against Windows' MAX_PATH; a UUID fits. */
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/;
const TASK_BRANCH_PREFIX = "office/";
/** A throwaway worktree's folder starts with it, which no Task id does. */
const THROWAWAY_PREFIX = "_";
const INSTALL_RECORD = "office-install";
/** Changed when installs change how they run, so worktrees installed the old way install again. */
const INSTALL_RECORD_VERSION = 1;
const INSTALL_TIMEOUT_MS = 30 * 60_000;

/** The commit a new worktree starts at. */
export interface BaseBranch {
  readonly commit: string;
  /** Where it was fetched from, or undefined when the base branch tracks no remote branch. */
  readonly fetchedFrom: Upstream | undefined;
}

export interface TaskWorktree {
  readonly path: string;
  readonly branch: string;
}

export interface InstallOptions {
  /** The environment to install with, when not the Project's own. */
  readonly environment?: ProjectEnvironment;
  /** Stops the install when aborted. */
  readonly signal?: AbortSignal;
}

/** Whether a worktree's install ran, and how it went. */
export type Installation =
  { readonly kind: "up-to-date" } | { readonly kind: "ran"; readonly run: CommandRun };

/** A throwaway worktree of the base branch, such as the environment check's. */
export interface ThrowawayWorktree {
  readonly path: string;
  readonly base: BaseBranch;
}

/**
 * The Projects' worktrees under the Office data directory (spec §5.5): one per Task at a stable
 * path, so a resumed session finds it where it left it, with the Project's dependencies installed
 * in it; and throwaway ones, which never share a path with a Task's.
 */
@Injectable()
export class Worktrees {
  private readonly logger = new Logger(Worktrees.name);
  private readonly operatingSystem = currentOperatingSystem();

  constructor(
    private readonly git: Git,
    private readonly commands: ProjectCommandRunner,
    private readonly officeData: OfficeDataDirectory,
  ) {}

  /** `<office-data>/worktrees/<project>/<task>`. */
  pathOf(project: Project, taskId: string): string {
    if (!TASK_ID.test(taskId)) throw new Error(`"${taskId}" can't name a Task's worktree.`);
    return join(this.projectFolder(project), taskId);
  }

  branchOf(taskId: string): string {
    return `${TASK_BRANCH_PREFIX}${taskId}`;
  }

  /**
   * The Task's worktree on its branch, with dependencies installed. The first time, the branch
   * starts at the freshly fetched base branch; after that the worktree is as the Task left it.
   */
  async prepare(
    project: Project,
    taskId: string,
  ): Promise<{ readonly worktree: TaskWorktree; readonly installation: Installation }> {
    const worktree = { path: this.pathOf(project, taskId), branch: this.branchOf(taskId) };
    if (!(await exists(worktree.path))) await this.add(project, worktree);
    return { worktree, installation: await this.install(project, worktree.path) };
  }

  /**
   * The commit the base branch's upstream names once fetched, or the local base branch's when it
   * tracks no remote branch (spec §9).
   */
  async freshBase(project: Project, variables: GitVariables): Promise<BaseBranch> {
    const upstream = await this.git.upstreamOf(project.path, project.baseBranch);
    if (!upstream) {
      return {
        commit: await this.git.commitOf(project.path, project.baseBranch),
        fetchedFrom: undefined,
      };
    }
    return {
      commit: await this.git.fetch(project.path, upstream, variables),
      fetchedFrom: upstream,
    };
  }

  /**
   * Runs the install command in the worktree, unless the command, the install inputs and the
   * environment are what they were at its last install there that passed.
   */
  async install(
    project: Project,
    worktreePath: string,
    { environment = project.environment, signal }: InstallOptions = {},
  ): Promise<Installation> {
    const record = await this.git.worktreeRecordPath(worktreePath, INSTALL_RECORD);
    const fingerprint = await installFingerprint(project, worktreePath, environment);
    if ((await readFile(record, "utf8").catch(() => undefined)) === fingerprint) {
      return { kind: "up-to-date" };
    }
    const run = await this.commands.run({
      commandLine: project.commands.install,
      folder: worktreePath,
      environment,
      timeoutMs: INSTALL_TIMEOUT_MS,
      signal,
    });
    if (run.outcome === "passed") await writeFile(record, fingerprint);
    return { kind: "ran", run };
  }

  /** Removes the Task's worktree with whatever it holds; its branch stays. */
  async remove(project: Project, taskId: string): Promise<void> {
    await this.git.removeWorktree(
      project.path,
      this.pathOf(project, taskId),
      this.commands.variablesFor(project.environment),
    );
  }

  /**
   * A detached worktree of the freshly fetched base branch at a path of its own. The Project's
   * earlier throwaway worktrees go first: one a running process kept from being removed would
   * otherwise stay for good.
   */
  async addThrowaway(
    project: Project,
    environment: ProjectEnvironment,
  ): Promise<ThrowawayWorktree> {
    const variables = this.commands.variablesFor(environment);
    await this.removeThrowaways(project, variables);
    const path = join(
      this.projectFolder(project),
      `${THROWAWAY_PREFIX}${randomBytes(4).toString("hex")}`,
    );
    this.refuseTooLong(path);
    const base = await this.freshBase(project, variables);
    await mkdir(dirname(path), { recursive: true });
    await this.git.addWorktree(
      project.path,
      { path, checkout: { kind: "detached", startPoint: base.commit } },
      variables,
    );
    return { path, base };
  }

  async removeThrowaway(
    project: Project,
    path: string,
    environment: ProjectEnvironment,
  ): Promise<void> {
    await this.git.removeWorktree(project.path, path, this.commands.variablesFor(environment));
  }

  private async removeThrowaways(project: Project, variables: GitVariables): Promise<void> {
    const folder = this.projectFolder(project);
    const names = await readdir(folder).catch(() => []);
    for (const name of names.filter((each) => each.startsWith(THROWAWAY_PREFIX))) {
      await this.git.removeWorktree(project.path, join(folder, name), variables).catch((error) => {
        this.logger.warn(`A throwaway worktree stays at ${join(folder, name)}: ${String(error)}`);
      });
    }
  }

  private projectFolder(project: Project): string {
    return join(this.officeData.folder("worktrees"), project.id);
  }

  private refuseTooLong(path: string): void {
    const tooLong = this.operatingSystem.paths.lengthProblem(path, "directory");
    if (tooLong) throw new Error(`The worktree can't be made at ${path}. ${tooLong}`);
  }

  private async add(project: Project, worktree: TaskWorktree): Promise<void> {
    this.refuseTooLong(worktree.path);
    const variables = this.commands.variablesFor(project.environment);
    // A branch left from a worktree removed earlier is checked out as it is.
    const checkout: WorktreeCheckout = (await this.git.hasBranch(project.path, worktree.branch))
      ? { kind: "branch", branch: worktree.branch }
      : {
          kind: "new-branch",
          branch: worktree.branch,
          startPoint: (await this.freshBase(project, variables)).commit,
        };
    await mkdir(dirname(worktree.path), { recursive: true });
    await this.git.addWorktree(project.path, { path: worktree.path, checkout }, variables);
  }
}

async function installFingerprint(
  project: Project,
  worktreePath: string,
  environment: ProjectEnvironment,
): Promise<string> {
  const inputs = await Promise.all(
    project.installInputs.map(async (input) => {
      const content = await readFile(join(worktreePath, input)).catch(() => undefined);
      return [input, content && createHash("sha256").update(content).digest("hex")];
    }),
  );
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: INSTALL_RECORD_VERSION,
        command: project.commands.install,
        environment,
        inputs,
      }),
    )
    .digest("hex");
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}
