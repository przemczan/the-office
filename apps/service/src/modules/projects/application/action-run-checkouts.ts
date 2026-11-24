import { appendFile, mkdir, readdir, rm } from "node:fs/promises";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import type { CommandOutcome } from "../domain/command-run.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectRefused } from "../domain/project-refused.js";
import type { Project } from "../domain/project.js";
import { Git } from "../ports/git.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { DetachedCheckouts } from "./detached-checkouts.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { TaskBases } from "./task-bases.js";

/** A branch's tip as a start shows it: the commit and its subject. */
export interface ActionRunTip {
  readonly commit: string;
  readonly subject: string;
}

/** One of the commands a Project command run runs, by the name its log gives it. */
export interface ActionRunCommandLine {
  readonly name: string;
  readonly commandLine: string;
}

/** A variable The Office sets in a Project command run (spec §2.15, "What The Office sets"). */
export interface ActionRunVariable {
  readonly name: string;
  readonly value: string;
}

/** A Project command run on the workstation, with the Project's Run environment Off. */
export interface WorkstationActionRun {
  readonly runId: string;
  readonly projectId: string;
  /** The commands before it, then the command itself, last; run one after another. */
  readonly commands: readonly ActionRunCommandLine[];
  /** What The Office sets, over the Project's environment. */
  readonly variables: readonly ActionRunVariable[];
  /** How long the commands may take together. */
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/** How a Project command run's commands ended. */
export interface ActionRunCommandEnd {
  /** The command it ended on: the first that didn't end with 0, else the last. */
  readonly name: string;
  readonly outcome: CommandOutcome;
  /** Undefined when it never exited by itself. */
  readonly exitCode: number | undefined;
}

/** An Action run's id, which names its folder and its log. */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * Each Project command run's own checkout (spec §5.5, "An Action run's checkout"): the branch
 * fetched by the rules a test instance's follows, then the commit's files written into
 * `<office-data>/action-runs/<run id>/` with no `.git` at all, its log
 * `<office-data>/action-runs/<run id>.log` beside it; and the run's commands on the workstation,
 * in that checkout, with the Project's environment and Secret variables as a Task's checks get
 * them, masked in the log, and never The Office's own credentials.
 */
@Injectable()
export class ActionRunCheckouts {
  private readonly checkouts: DetachedCheckouts;
  private readonly parent: string;

  constructor(
    private readonly projects: ProjectRepository,
    taskBases: TaskBases,
    private readonly git: Git,
    private readonly commands: ProjectCommandRunner,
    private readonly officeData: OfficeDataDirectory,
  ) {
    this.parent = officeData.folder("action-runs");
    this.checkouts = new DetachedCheckouts(
      taskBases,
      git,
      commands,
      this.parent,
      "an Action run's",
    );
  }

  /** The run's checkout, an absolute path. */
  folderOf(runId: string): string {
    return this.officeData.actionRunFolder(checkedRunId(runId));
  }

  /** The run's log, beside its checkout. */
  logFileOf(runId: string): string {
    return this.officeData.actionRunLog(checkedRunId(runId));
  }

  /**
   * The branch's tip, fetched first by the rules a test instance's checkout follows, with its
   * subject: what the Run window shows and a start runs. Refused (ProjectRefused) when neither the
   * repository nor its remote has the branch, the two have diverged, or git fails.
   */
  async branchTip(projectId: string, branch: string): Promise<ActionRunTip> {
    const project = await this.projectOf(projectId);
    const commit = await this.checkouts.freshTip(project, branch);
    return { commit, subject: await this.git.subjectOf(project.path, commit) };
  }

  /**
   * Whether the base branch's remote has the branch, asked now: a Workflow runs only from one it
   * has. False when the base branch tracks no remote.
   */
  async remoteHasBranch(projectId: string, branch: string): Promise<boolean> {
    const project = await this.projectOf(projectId);
    const upstream = await this.git.upstreamOf(project.path, project.baseBranch);
    if (upstream === undefined) return false;
    return this.git.remoteHasBranch(
      project.path,
      { remote: upstream.remote, branch },
      this.commands.variablesFor(project.environment),
    );
  }

  /**
   * Writes the files of `commit`, a tip `branchTip` fetched, into the run's own checkout, replacing
   * anything there, and answers the folder. Refused (ProjectRefused) when git fails; a failed
   * checkout leaves no folder.
   */
  async checkOut(
    projectId: string,
    runId: string,
    branch: string,
    commit: string,
  ): Promise<string> {
    const project = await this.projectOf(projectId);
    const folder = this.folderOf(runId);
    await mkdir(this.parent, { recursive: true });
    await this.checkouts.exportInto(project, branch, commit, folder);
    return folder;
  }

  /** Removes the run's checkout, best effort: one already gone is no failure. */
  async remove(runId: string): Promise<void> {
    await this.checkouts.remove(this.folderOf(runId));
  }

  /** Removes the run's log, as its run is removed; one already gone is no failure. */
  async removeLog(runId: string): Promise<void> {
    await rm(this.logFileOf(runId), { force: true }).catch(() => undefined);
  }

  /** The ids of the runs whose checkout is still here, which the sweep as The Office starts removes. */
  async leftoverRunIds(): Promise<string[]> {
    const entries = await readdir(this.parent, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    return entries
      .filter((entry) => entry.isDirectory() && RUN_ID.test(entry.name))
      .map(({ name }) => name);
  }

  /**
   * Runs the commands one after another on the workstation, in the run's checkout, in the
   * Project's shell as checks run there, each named in the log first ("Running <name>."); its
   * output appended to the log, the Project's Secret variables masked. The commands share the
   * run's time. Ends on the first that doesn't end with 0, answering it.
   */
  async run(run: WorkstationActionRun): Promise<ActionRunCommandEnd> {
    if (run.commands.length === 0) throw new ProjectRefused(["The run has no command to run."]);
    const project = await this.projectOf(run.projectId);
    const folder = this.folderOf(run.runId);
    this.checkouts.ensureInside(folder);
    const logFile = this.logFileOf(run.runId);
    const deadline = Date.now() + run.timeoutMs;
    const officeNames = new Set(run.variables.map(({ name }) => name));
    const environment = {
      ...project.environment,
      set: [
        ...project.environment.set.filter(({ name }) => !officeNames.has(name)),
        ...run.variables.map(({ name, value }) => ({ name, value, secret: false })),
      ],
    };
    let ended: ActionRunCommandEnd | undefined;
    for (const { name, commandLine } of run.commands) {
      await appendFile(logFile, `Running ${name}.\n`);
      const { outcome, exitCode } = await this.commands.run({
        commandLine,
        folder,
        environment,
        timeoutMs: Math.max(1, deadline - Date.now()),
        signal: run.signal,
        outputFile: logFile,
        appendOutput: true,
      });
      ended = { name, outcome, exitCode };
      if (outcome !== "passed") return ended;
    }
    return ended as ActionRunCommandEnd;
  }

  private async projectOf(projectId: string): Promise<Project> {
    const project = await this.projects.find(projectId);
    if (!project) throw new ProjectNotFound(projectId);
    return project;
  }
}

function checkedRunId(runId: string): string {
  if (!RUN_ID.test(runId)) throw new Error(`${runId} isn't an Action run's id.`);
  return runId;
}
