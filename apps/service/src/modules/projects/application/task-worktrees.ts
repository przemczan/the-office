import { Injectable } from "@nestjs/common";
import type {
  Publication,
  PublishingBranchPush,
  PublishTarget,
  PullRequestText,
} from "../domain/publication.js";
import type { ResolveEnd, ResolveStart } from "../domain/resolve.js";
import type { CommandRun } from "../domain/command-run.js";
import {
  commandOf,
  isCommandSet,
  type Project,
  type ProjectCommandKind,
  type PublishingLine,
} from "../domain/project.js";
import type { Head } from "../ports/git.js";
import {
  AgentCommands,
  type AgentCommand,
  type AgentCommandEnd,
  type AgentCommandOptions,
} from "./agent-commands.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ProjectService } from "./project-service.js";
import { Publishing } from "./publishing.js";
import type { BranchUpdate, ConflictHandling } from "../domain/branch-update.js";
import { BranchUpdates } from "./branch-updates.js";
import { Resolving } from "./resolving.js";
import { SCREENSHOTS_FOLDER } from "./screenshots-folder.js";
import {
  ScriptCommands,
  type ScriptCommandOptions,
  type ScriptCommandRun,
} from "./script-commands.js";
import {
  Worktrees,
  type Installation,
  type TaskChanges,
  type TaskInstallOptions,
} from "./worktrees.js";

/** A Task's worktree, as a session works in it. */
export interface SessionWorktree {
  readonly path: string;
  readonly branch: string;
  /** The Project's command environment, which the session and its commands run with. */
  readonly environment: Readonly<Record<string, string>>;
  /** Where the Agent writes its screenshots, relative to the worktree with "/" between folders. */
  readonly screenshotsFolder: string;
}

/**
 * The Tasks' worktrees for the modules that run sessions on a Task, and the git changes The Office
 * makes in them (spec §5.5). Each method throws ProjectNotFound when there is no such Project.
 */
@Injectable()
export class TaskWorktrees {
  constructor(
    private readonly projects: ProjectService,
    private readonly worktrees: Worktrees,
    private readonly commands: ProjectCommandRunner,
    private readonly scriptCommands: ScriptCommands,
    private readonly agentCommands: AgentCommands,
    private readonly publishing: Publishing,
    private readonly resolving: Resolving,
    private readonly branchUpdates: BranchUpdates,
  ) {}

  /**
   * The Task's worktree, made the first time on a branch of its own at the freshly fetched base
   * branch, without installing.
   */
  async open(projectId: string, taskId: string): Promise<SessionWorktree> {
    const project = await this.projects.read(projectId);
    const { path, branch } = await this.worktrees.open(project, taskId);
    return {
      path,
      branch,
      environment: this.commands.variablesFor(project.environment),
      screenshotsFolder: SCREENSHOTS_FOLDER,
    };
  }

  /** Where the Task's worktree is, without running git. */
  async find(projectId: string, taskId: string): Promise<SessionWorktree> {
    const project = await this.projects.read(projectId);
    return {
      path: this.worktrees.pathOf(project, taskId),
      branch: await this.worktrees.branchOf(project, taskId),
      environment: this.commands.variablesFor(project.environment),
      screenshotsFolder: SCREENSHOTS_FOLDER,
    };
  }

  /** Whether the Task has a worktree in the Project: its folder is there. Runs no git. */
  async exists(projectId: string, taskId: string): Promise<boolean> {
    return this.worktrees.exists(await this.projects.read(projectId), taskId);
  }

  /** Brings the Task's branch to the freshly fetched base; `onConflict` says what a conflict does. */
  async updateFromBase(
    projectId: string,
    taskId: string,
    onConflict: ConflictHandling,
  ): Promise<BranchUpdate> {
    return this.branchUpdates.update(await this.projects.read(projectId), taskId, onConflict);
  }

  /** Whether the Task's worktree holds a merge of the base left for an Agent to resolve. */
  async mergeInProgress(projectId: string, taskId: string): Promise<boolean> {
    return this.branchUpdates.mergeInProgress(await this.projects.read(projectId), taskId);
  }

  /** Whether the Task's branch moved from `from` along the freshly fetched base, losing nothing. */
  async movedAlongBase(projectId: string, taskId: string, from: string): Promise<boolean> {
    return this.branchUpdates.movedAlongBase(await this.projects.read(projectId), taskId, from);
  }

  /** The commit and branch the Task's worktree has checked out. */
  async head(projectId: string, taskId: string): Promise<Head> {
    return this.worktrees.head(await this.projects.read(projectId), taskId);
  }

  /**
   * Commits every change in the Task's worktree to its branch. Returns the new commit, or
   * undefined when nothing changed.
   */
  async commit(projectId: string, taskId: string, message: string): Promise<string | undefined> {
    return this.worktrees.commit(await this.projects.read(projectId), taskId, message);
  }

  /**
   * After a Stage's commit, pushes a Publishing Task's Initiative's branch to the base branch's
   * remote, without force, on the Office identity (spec §5.5, "Pushed"); not needed for any other
   * Task, or when the base branch tracks no remote. A refused push answers why, which doesn't fail
   * the Stage.
   */
  async pushPublishingBranch(projectId: string, taskId: string): Promise<PublishingBranchPush> {
    return this.publishing.pushPublishingBranch(await this.projects.read(projectId), taskId);
  }

  /**
   * Drops every uncommitted change in the Task's worktree, untracked files included and ignored
   * ones kept, as for a Stage the user stopped. Returns the dropped paths.
   */
  async discard(projectId: string, taskId: string): Promise<readonly string[]> {
    return this.worktrees.discard(await this.projects.read(projectId), taskId);
  }

  /** A few lines of what the Task's commits changed so far; undefined while nothing. */
  async changesSoFar(projectId: string, taskId: string): Promise<string | undefined> {
    return this.worktrees.changesSoFar(await this.projects.read(projectId), taskId);
  }

  /**
   * The files, line counts and diff of what the Task's commits changed since its branch left the
   * base branch, as the Changes tab shows them, with the worktree's path while it has one; none
   * before the Task has a branch.
   */
  async changes(projectId: string, taskId: string): Promise<TaskChanges> {
    return this.worktrees.changes(await this.projects.read(projectId), taskId);
  }

  /**
   * Publishes the Task's committed branch by the Project's publishing mode (spec §9), or pushes it
   * only, as the Publish Stage's target says (spec §2.3).
   */
  async publish(
    projectId: string,
    taskId: string,
    text: PullRequestText,
    target: PublishTarget,
  ): Promise<Publication> {
    return this.publishing.publish(await this.projects.read(projectId), taskId, text, target);
  }

  /**
   * Resolve's start (spec §2.3, "Conflicts at Publish"): merges the freshly fetched base into the
   * Task's branch, leaving the conflicted files in its worktree for the Task's person.
   */
  async startResolve(projectId: string, taskId: string): Promise<ResolveStart> {
    return this.resolving.start(await this.projects.read(projectId), taskId);
  }

  /** Commits Resolve's merge as one merge commit, unless a conflict marker remains. */
  async finishResolve(projectId: string, taskId: string): Promise<ResolveEnd> {
    return this.resolving.finish(await this.projects.read(projectId), taskId);
  }

  /** Gives the Task's worktree and branch back as they were before Resolve's merge began. */
  async abandonResolve(projectId: string, taskId: string): Promise<void> {
    await this.resolving.abandon(await this.projects.read(projectId), taskId);
  }

  /**
   * Removes the Task's worktree with whatever it holds; its branch stays. A Publishing Task's
   * Initiative's branch is kept too, so a later Publishing Task can check it out.
   */
  async removeWorktree(projectId: string, taskId: string): Promise<void> {
    await this.worktrees.remove(await this.projects.read(projectId), taskId);
  }

  /**
   * Installs the Project's dependencies in the Task's worktree, where the Project's Run
   * environment setting says, unless the install command, its inputs, the environment and that
   * place are as they were at its last install there that passed. `signal` stops it, with
   * everything it started, or its wait for a run environment; `wait` is told of that wait.
   */
  async install(
    projectId: string,
    taskId: string,
    options: TaskInstallOptions,
  ): Promise<Installation> {
    const { installation } = await this.worktrees.prepare(
      await this.projects.read(projectId),
      taskId,
      options,
    );
    return installation;
  }

  /**
   * Runs a Script Stage's Project command, by its key, in the Task's worktree: after each run of a
   * test command the worktree is restored and the files it wrote are moved to a folder named by `stageRunId`, and
   * a failing test command runs once more. It runs where the Project's Run environment setting
   * says. Returns the command's kind, undefined for a key the Project lacks, and each run, in
   * order. `signal` stops the command running, with everything it started, or its wait for a run
   * environment, and runs no other; `wait` is told of that wait.
   */
  async runCommand(
    projectId: string,
    taskId: string,
    key: string,
    stageRunId: string,
    options: ScriptCommandOptions,
  ): Promise<{
    readonly kind: ProjectCommandKind | undefined;
    readonly runs: readonly ScriptCommandRun[];
  }> {
    const project = await this.projects.read(projectId);
    const runs = await this.scriptCommands.run(project, taskId, key, stageRunId, options);
    return { kind: commandOf(project, key)?.kind, runs };
  }

  /** The Project's before and after publishing lines, each blank when not set. */
  async publishingLines(projectId: string): Promise<Pick<Project, PublishingLine>> {
    const { beforePublishingCommand, afterPublishingCommand } = await this.projects.read(projectId);
    return { beforePublishingCommand, afterPublishingCommand };
  }

  /**
   * Runs a Publish's before or after publishing line (spec §2.3 Defaults) in the Task's worktree,
   * where a Script Stage's command runs, with its time limit and the Project's own variables,
   * `variables` set over them; never The Office's credentials. What it changes stays in the
   * worktree for the caller to commit. Undefined, with nothing run, when the line is blank.
   */
  async runPublishingLine(
    projectId: string,
    taskId: string,
    line: PublishingLine,
    variables: Readonly<Record<string, string>>,
    options: ScriptCommandOptions,
  ): Promise<CommandRun | undefined> {
    const project = await this.projects.read(projectId);
    const commandLine = project[line];
    if (!isCommandSet(commandLine)) return undefined;
    return this.scriptCommands.runLine(project, taskId, commandLine, variables, options);
  }

  /**
   * Runs a command for an Agent at work on the Task: install or one of the Project's by its key, or a command
   * line it wrote, which the caller has judged. It runs where the Project's Run environment
   * setting says, after an install when its inputs changed, its whole output written to
   * `outputFile` as it runs. `signal` stops it, with everything it started, or its wait for a run
   * environment; `wait` is told of that wait.
   */
  async runForAgent(
    projectId: string,
    taskId: string,
    command: AgentCommand,
    options: AgentCommandOptions,
  ): Promise<AgentCommandEnd> {
    const project = await this.projects.read(projectId);
    return this.agentCommands.run(project, taskId, command, options);
  }
}
