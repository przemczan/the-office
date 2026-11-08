import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../platform/os/current-operating-system.js";
import type { CommandRun } from "../domain/command-run.js";
import type { Project } from "../domain/project.js";
import type { ProjectEnvironment } from "../domain/project-environment.js";
import {
  Git,
  NO_BRANCH_CHANGES,
  type BranchChanges,
  type GitVariables,
  type Head,
  type Upstream,
  type WorktreeCheckout,
} from "../ports/git.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ensureScreenshotsFolder } from "./screenshots-folder.js";
import { TaskCommandRunner, type CommandPlace } from "./task-command-runner.js";
import type { CommandWait } from "./task-run-environments.js";

/** Short, as worktree paths count against Windows' MAX_PATH; a UUID fits. */
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/;
const TASK_BRANCH_PREFIX = "office/";
const PUBLISHED_FROM_PREFIX = "refs/office/published-from/";
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

/** How a Task's install is stopped, and told of a wait for its run environment. */
export interface TaskInstallOptions {
  /** Stops the install, or its wait, when aborted. */
  readonly signal?: AbortSignal;
  readonly wait?: CommandWait;
}

/** Whether a worktree's install ran, and how it went. */
export type Installation =
  { readonly kind: "up-to-date" } | { readonly kind: "ran"; readonly run: CommandRun };

/**
 * What a Task's commits changed, and where its worktree is while it has one, so the user can open
 * it in their editor.
 */
export interface TaskChanges extends BranchChanges {
  /** Undefined before the worktree is made and after Publish removes it. */
  readonly worktreePath: string | undefined;
}

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
    private readonly taskCommands: TaskCommandRunner,
    private readonly officeData: OfficeDataDirectory,
  ) {}

  /** `<office-data>/worktrees/<project>/<task>`. */
  pathOf(project: Project, taskId: string): string {
    if (!TASK_ID.test(taskId)) throw new Error(`"${taskId}" can't name a Task's worktree.`);
    return join(this.projectFolder(project), taskId);
  }

  /** Whether the Task's worktree folder is there. */
  async exists(project: Project, taskId: string): Promise<boolean> {
    return exists(this.pathOf(project, taskId));
  }

  branchOf(taskId: string): string {
    return `${TASK_BRANCH_PREFIX}${taskId}`;
  }

  /**
   * The Office's own ref of where the Task's branch forked from the base when it was published,
   * which its changes are read from after that (the user's answer of 2026-10-26).
   */
  publishedFromRefOf(taskId: string): string {
    return `${PUBLISHED_FROM_PREFIX}${taskId}`;
  }

  /**
   * The Task's worktree on its branch, with dependencies installed where the Task's commands run
   * (TaskCommandRunner). The first time, the branch starts at the freshly fetched base branch;
   * after that the worktree is as the Task left it.
   */
  async prepare(
    project: Project,
    taskId: string,
    { signal, wait }: TaskInstallOptions = {},
  ): Promise<{ readonly worktree: TaskWorktree; readonly installation: Installation }> {
    const worktree = await this.open(project, taskId);
    const place = await this.taskCommands.placeOf(project, taskId, worktree.path);
    const installation = await this.installOnce(
      project,
      worktree.path,
      place,
      project.environment,
      () =>
        this.taskCommands.run(project, taskId, worktree.path, {
          commandLine: project.commands.install,
          timeoutMs: INSTALL_TIMEOUT_MS,
          signal,
          wait,
        }),
    );
    return { worktree, installation };
  }

  /**
   * The Task's worktree on its branch, without installing: enough to read it, as planning does.
   * The first time, the branch starts at the freshly fetched base branch. Its screenshots folder
   * is made each time, so a worktree made before it, or one whose folder was removed, has it too.
   */
  async open(project: Project, taskId: string): Promise<TaskWorktree> {
    const worktree = { path: this.pathOf(project, taskId), branch: this.branchOf(taskId) };
    if (!(await exists(worktree.path))) await this.add(project, worktree);
    await ensureScreenshotsFolder(worktree.path);
    return worktree;
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
   * Runs the install command in the worktree on the host, as the environment check does, unless
   * the command, the install inputs and the environment are what they were at its last install
   * there that passed.
   */
  async install(
    project: Project,
    worktreePath: string,
    { environment = project.environment, signal }: InstallOptions = {},
  ): Promise<Installation> {
    return this.installOnce(project, worktreePath, { kind: "host" }, environment, () =>
      this.commands.run({
        commandLine: project.commands.install,
        folder: worktreePath,
        environment,
        timeoutMs: INSTALL_TIMEOUT_MS,
        signal,
      }),
    );
  }

  /**
   * Commits every change in the Task's worktree to its branch, as a Stage ends. Returns the new
   * commit, or undefined when the Stage changed nothing.
   */
  async commit(project: Project, taskId: string, message: string): Promise<string | undefined> {
    const path = this.pathOf(project, taskId);
    // An Agent may have removed the folder's own `.gitignore`; no commit may hold its screenshots.
    await ensureScreenshotsFolder(path);
    return this.git.commit(path, message, this.variablesOf(project));
  }

  /**
   * Where the Task's worktree is: the after-Stage check compares it with where it was. A worktree
   * Publish removed is made again from the Task's branch first, as for a Stage after Publish.
   */
  async head(project: Project, taskId: string): Promise<Head> {
    return this.git.head((await this.open(project, taskId)).path);
  }

  /**
   * A few lines of what the Task's commits changed since its branch left the base branch, for a
   * Brief; undefined while they change nothing.
   */
  async changesSoFar(project: Project, taskId: string): Promise<string | undefined> {
    const summary = await this.git.diffSummary(
      this.pathOf(project, taskId),
      project.baseBranch,
      await this.publishedFrom(project, taskId),
    );
    return summary === "" ? undefined : summary;
  }

  /**
   * What the Task's commits changed since its branch left the base branch, read from the
   * repository, so it is there with or without the worktree; nothing before the Task has a branch.
   * Once published, since where the published branch forked, so it stays after the base takes it.
   * With where the worktree is, while it is there.
   */
  async changes(project: Project, taskId: string): Promise<TaskChanges> {
    const path = this.pathOf(project, taskId);
    const branch = this.branchOf(taskId);
    const [changes, worktreeExists] = await Promise.all([
      this.git
        .hasBranch(project.path, branch)
        .then(async (has) =>
          has
            ? this.git.branchChanges(
                project.path,
                project.baseBranch,
                branch,
                await this.publishedFrom(project, taskId),
              )
            : NO_BRANCH_CHANGES,
        ),
      exists(path),
    ]);
    return { ...changes, worktreePath: worktreeExists ? path : undefined };
  }

  /** Where the Task's branch forked from the base when it was published; undefined before. */
  private async publishedFrom(project: Project, taskId: string): Promise<string | undefined> {
    return this.git.findCommit(project.path, this.publishedFromRefOf(taskId));
  }

  /**
   * Reverts what a test run changed in tracked files, keeping untracked and ignored ones. Returns
   * the reverted paths.
   */
  async restore(project: Project, taskId: string): Promise<readonly string[]> {
    return this.git.restore(this.pathOf(project, taskId), this.variablesOf(project));
  }

  /**
   * The Task's worktree's untracked files that aren't ignored, which the next commit would add,
   * relative to it with "/" between folders.
   */
  async untracked(project: Project, taskId: string): Promise<readonly string[]> {
    return this.git.untracked(this.pathOf(project, taskId), this.variablesOf(project));
  }

  /** Drops an interrupted Stage's uncommitted edits. Returns the dropped paths. */
  async discard(project: Project, taskId: string): Promise<readonly string[]> {
    return this.git.discard(this.pathOf(project, taskId), this.variablesOf(project));
  }

  /** Removes the Task's worktree with whatever it holds; its branch stays. */
  async remove(project: Project, taskId: string): Promise<void> {
    await this.git.removeWorktree(
      project.path,
      this.pathOf(project, taskId),
      this.variablesOf(project),
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

  /**
   * Runs `install` unless the worktree's record says the same install passed there last: the same
   * command, install inputs and environment, in the same place.
   */
  private async installOnce(
    project: Project,
    worktreePath: string,
    place: CommandPlace,
    environment: ProjectEnvironment,
    install: () => Promise<CommandRun>,
  ): Promise<Installation> {
    const record = await this.git.worktreeRecordPath(worktreePath, INSTALL_RECORD);
    const fingerprint = await installFingerprint(project, worktreePath, environment, place);
    if ((await readFile(record, "utf8").catch(() => undefined)) === fingerprint) {
      return { kind: "up-to-date" };
    }
    const run = await install();
    if (run.outcome === "passed") await writeFile(record, fingerprint);
    return { kind: "ran", run };
  }

  /** Git on a Project runs with the Project's variables, as its hooks and filters run its tools. */
  private variablesOf(project: Project): GitVariables {
    return this.commands.variablesFor(project.environment);
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
    const variables = this.variablesOf(project);
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
  place: CommandPlace,
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
        // Left out on the host, so the records of installs made before run environments still hold.
        ...(place.kind === "host" ? {} : { place }),
      }),
    )
    .digest("hex");
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}
