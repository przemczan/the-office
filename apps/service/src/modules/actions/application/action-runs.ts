import { randomUUID } from "node:crypto";
import { Injectable, Optional, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { OfficeTestInstance } from "../../../platform/test-instance/office-test-instance.js";
import {
  failedRun,
  isRunning,
  startedRun,
  stateWords,
  stoppedRun,
  stopWords,
  testTargetMoved,
  withCommit,
  type ActionRun,
  type ActionRunRanFrom,
  type ActionRunStopReason,
  type ActionRunUser,
} from "../domain/action-run.js";
import { ActionRunNotFound, ActionRunRefused } from "../domain/action-run-refused.js";
import {
  actionsAtOnceFull,
  FIRE_ALARM_ON,
  IN_A_TEST_INSTANCE,
  initiativeHasNoBranch,
  initiativeNotActive,
  movedSinceYouLooked,
  noConfirmedCommit,
  noSuchInitiative,
  noSuchTask,
  notFromTheBaseBranch,
  notOnTheRemote,
  runningAlready,
  targetGone,
  taskEnded,
  taskHasNoBranch,
  taskOfAnotherProject,
  WORKFLOW_HAS_NO_STOP,
} from "../domain/action-run-words.js";
import { ActionProjects, type RunAction, type RunProject } from "../ports/action-projects.js";
import { ActionRunRepository, ActionRunningAlready } from "../ports/action-run-repository.js";
import { ActionSettingsStore } from "../ports/action-settings-store.js";
import { ActionSources } from "../ports/action-sources.js";
import {
  ActionTestInstances,
  type RunTestInstance,
  type TestInstanceMove,
} from "../ports/action-test-instances.js";
import { ActionRunLogs } from "./action-run-logs.js";
import { ActionRunRecords } from "./action-run-records.js";
import { CommandRuns } from "./command-runs.js";
import { RunsInBackground } from "./runs-in-background.js";
import { WorkflowRuns } from "./workflow-runs.js";

/** What a start chooses to run from (spec §2.15, "What it runs from"). */
export type ActionRunSource =
  | { readonly kind: "branch"; readonly branch: string }
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "initiative"; readonly initiativeId: string };

/** A start: what it runs from, and the commit its confirm step showed. */
export interface ActionRunStart {
  readonly source: ActionRunSource;
  readonly commit?: string | undefined;
}

/** What a start from a source would run, or why it can't be read. */
export type ActionRunSourceTip =
  | {
      readonly kind: "tip";
      readonly branch: string;
      readonly commit: string;
      readonly subject: string;
    }
  | { readonly kind: "problem"; readonly problem: string };

/** A run's log from an offset, with the run, so a reader stops once it has ended. */
export interface ActionRunLogRead {
  readonly text: string;
  readonly nextOffset: number;
  readonly run: ActionRun;
}

/** One Action's runs, newest first. */
export interface ActionRunHistory {
  readonly actionKey: string;
  readonly runs: readonly ActionRun[];
}

/** A Project command run running now, as Activity lists it. */
export interface RunningCommandRun {
  readonly id: string;
  readonly projectId: string;
  readonly actionKey: string;
  readonly actionName: string;
  readonly branch: string;
  /** Who started it, by name. */
  readonly startedBy: string;
  readonly startedAt: Date;
}

/** A run's last state, as the Project's record names it. */
export interface LastActionRun {
  readonly state: string;
  readonly startedAt: Date;
}

/** Where a start runs from, resolved: the branch, as the run records it, and how a refusal names it. */
interface ResolvedSource {
  readonly branch: string;
  readonly ranFrom: ActionRunRanFrom;
  readonly chosen: string;
}

/**
 * Action runs (spec §2.15): starting an Action on a branch, a Task or an Initiative, refused by the
 * switch, a test instance of The Office, the fire alarm, one run of each Action at a time, Actions
 * at once and the Leaves the workstation rules; a Project command run in the background
 * (`CommandRuns`), a Test target run's test instance followed, a Workflow run on the code host
 * followed (`WorkflowRuns`); Stop, the stops of the reactions, the removal of an Action's runs and
 * the sweep as The Office starts; each Action's History and each run's log.
 */
@Injectable()
export class ActionRuns implements OnModuleInit, OnModuleDestroy {
  /** The checks of the limits with the insert, one start at a time. */
  private starting: Promise<unknown> = Promise.resolve();
  /** The words a user's Stop on a Test target run ends it with, by its instance. */
  private readonly stoppingInstances = new Map<string, string>();

  constructor(
    private readonly repository: ActionRunRepository,
    private readonly settings: ActionSettingsStore,
    private readonly projects: ActionProjects,
    private readonly sources: ActionSources,
    private readonly testInstances: ActionTestInstances,
    private readonly commandRuns: CommandRuns,
    private readonly workflowRuns: WorkflowRuns,
    private readonly records: ActionRunRecords,
    private readonly logs: ActionRunLogs,
    private readonly schedule: Schedule,
    private readonly background: RunsInBackground,
    @Optional() private readonly officeTestInstance?: OfficeTestInstance,
  ) {}

  onModuleInit(): void {
    this.testInstances.onMoved((move) => {
      // In the background: the bus waits for its handlers, and the instance's move for nothing.
      this.background.start(
        `The Action run of the test instance ${move.instanceId} didn't follow it.`,
        () => this.followInstance(move),
      );
    });
  }

  onModuleDestroy(): void {
    this.workflowRuns.forgetAll();
  }

  /** Each of the Project's Actions' runs, newest first, in the Actions' order. */
  async list(projectId: string): Promise<readonly ActionRunHistory[]> {
    const [actions, runs] = await Promise.all([
      this.projects.actionsOf(projectId),
      this.repository.listOfProject(projectId),
    ]);
    const keys = [
      ...new Set([...actions.map(({ key }) => key), ...runs.map((run) => run.actionKey)]),
    ];
    return keys.map((actionKey) => ({
      actionKey,
      runs: runs.filter((run) => run.actionKey === actionKey),
    }));
  }

  async read(id: string): Promise<ActionRun> {
    const run = await this.repository.find(id);
    if (run === undefined) throw ActionRunNotFound.run(id);
    return run;
  }

  /** The Project command runs running now, as Activity lists them (spec §2.14). */
  async runningCommandRuns(): Promise<readonly RunningCommandRun[]> {
    return (await this.repository.running())
      .filter(({ status }) => status.kind === "project-command")
      .map((run) => ({
        id: run.id,
        projectId: run.projectId,
        actionKey: run.actionKey,
        actionName: run.actionName,
        branch: run.branch,
        startedBy: run.startedBy.name,
        startedAt: run.startedAt,
      }));
  }

  /** Each Action's last run in the Project, by key, as `list_projects` names it. */
  async lastRuns(projectId: string): Promise<ReadonlyMap<string, LastActionRun>> {
    const last = new Map<string, LastActionRun>();
    for (const run of await this.repository.listOfProject(projectId)) {
      if (!last.has(run.actionKey)) {
        last.set(run.actionKey, { state: stateWords(run.status), startedAt: run.startedAt });
      }
    }
    return last;
  }

  /** What a start from the source would run: its branch's fetched tip, or why it can't be read. */
  async sourceTip(projectId: string, source: ActionRunSource): Promise<ActionRunSourceTip> {
    try {
      const project = await this.projects.projectOf(projectId);
      const { branch } = await this.resolved(project, source);
      const tip = await this.projects.branchTip(projectId, branch);
      return { kind: "tip", branch, commit: tip.commit, subject: tip.subject };
    } catch (error) {
      if (error instanceof ActionRunRefused || error instanceof ActionRunNotFound) {
        return { kind: "problem", problem: error.message };
      }
      throw error;
    }
  }

  /**
   * Starts the Action on what was chosen, answering the run Running (a Test target run Building, a
   * Workflow run Starting) at once; the run goes on in the background. Refused (ActionRunRefused),
   * never queued, in the spec's words; an Action the Project doesn't have is ActionRunNotFound. A
   * command, target or Workflow gone since fails the run, naming it.
   */
  async start(
    projectId: string,
    actionKey: string,
    start: ActionRunStart,
    by: ActionRunUser,
  ): Promise<ActionRun> {
    if (this.officeTestInstance?.on === true) throw new ActionRunRefused([IN_A_TEST_INSTANCE]);
    if (await this.sources.fireAlarmOn()) throw new ActionRunRefused([FIRE_ALARM_ON]);
    const project = await this.projects.projectOf(projectId);
    if (!project.actionsOn) {
      throw new ActionRunRefused([`Actions are switched off for «${project.name}».`]);
    }
    const action = await this.projects.actionOf(projectId, actionKey);
    if (action === undefined) throw ActionRunNotFound.action(project.name, actionKey);
    const source = await this.resolved(project, start.source);
    if (action.leavesTheWorkstation) {
      if (start.source.kind !== "branch" || source.branch !== project.baseBranch) {
        throw new ActionRunRefused([
          notFromTheBaseBranch(action.name, project.baseBranch, source.chosen),
        ]);
      }
      if (start.commit === undefined) throw new ActionRunRefused([noConfirmedCommit(action.name)]);
    }
    if (
      action.kind === "workflow" &&
      !(await this.projects.remoteHasBranch(projectId, source.branch))
    ) {
      throw new ActionRunRefused([notOnTheRemote(source.branch)]);
    }
    const tip = await this.projects.branchTip(projectId, source.branch);
    if (action.leavesTheWorkstation && start.commit !== undefined) {
      if (!tip.commit.startsWith(start.commit)) {
        throw new ActionRunRefused([movedSinceYouLooked(source.branch, tip.commit)]);
      }
    }
    const targetThere =
      action.kind !== "test-target" ||
      (await this.projects.hasTestTarget(projectId, action.settings.targetKey));

    const { run, instance } = await this.oneAtATime(() =>
      this.added(project, action, source, tip.commit, by, targetThere),
    );
    await this.records.started(run);
    switch (action.kind) {
      case "project-command":
        this.commandRuns.begin(run, project);
        return run;
      case "workflow":
        this.workflowRuns.begin(run, action.settings.inputs);
        return run;
      case "test-target":
        if (instance === undefined) {
          const because = targetGone(action.settings.targetKey);
          await this.logs.note(run.id, `Failed: ${because}`);
          const at = this.schedule.now();
          return (await this.records.change(run.id, (kept) => failedRun(kept, because, at))) ?? run;
        }
        return (await this.applyInstance(run.id, instance)) ?? run;
    }
  }

  /**
   * Stops a running run: a Project command run Stopped with the reason's words, its compose
   * project, volumes and checkout removed, its log kept; a Test target run's test instance stopped.
   * A Workflow run is refused: The Office never cancels one. One that has ended stays as it is.
   */
  async stop(id: string, reason: ActionRunStopReason): Promise<ActionRun> {
    const run = await this.read(id);
    if (run.status.kind === "workflow") throw new ActionRunRefused([WORKFLOW_HAS_NO_STOP]);
    if (!isRunning(run)) return run;
    if (run.status.kind === "test-target") {
      if (run.testInstanceId === undefined) return run;
      this.stoppingInstances.set(run.testInstanceId, stopWords(reason));
      const instance = await this.testInstances.stop(run.testInstanceId);
      return (await this.applyInstance(run.id, instance)) ?? this.read(id);
    }
    const words = stopWords(reason);
    await this.logs.note(run.id, words);
    const changed = await this.records.change(id, (kept) =>
      stoppedRun(kept, reason, this.schedule.now()),
    );
    await this.commandRuns.halt(id);
    return changed ?? this.read(id);
  }

  /**
   * Stops every running Project command run, or only the Project's: the fire alarm's ASAP, the
   * Actions switch turned off. Test target and Workflow runs go on.
   */
  async stopEachCommandRun(reason: ActionRunStopReason, projectId?: string): Promise<void> {
    for (const run of await this.repository.running()) {
      if (run.status.kind !== "project-command") continue;
      if (projectId !== undefined && run.projectId !== projectId) continue;
      await this.stop(run.id, reason);
    }
  }

  /**
   * Removes the runs of the Project's Actions `actionKeys` with their logs, a running command run
   * stopped first; a test instance one of them launched stays in Test instances.
   */
  async removeRunsOf(projectId: string, actionKeys: readonly string[]): Promise<void> {
    for (const actionKey of actionKeys) {
      const runs = await this.repository.listOfAction(projectId, actionKey);
      for (const run of runs) {
        if (run.status.kind === "project-command" && isRunning(run)) {
          await this.stop(run.id, { kind: "action-removed" });
        }
      }
      await this.records.remove(projectId, actionKey, runs);
    }
  }

  /**
   * As The Office starts (from office.ts, never a module's start): every command run left running
   * ends Stopped, "The Office restarted while it ran.", and what they left is removed; Workflow
   * runs are followed again, Test target runs read their instance again. Logs stay.
   */
  async sweep(): Promise<void> {
    const reason: ActionRunStopReason = { kind: "restart" };
    for (const run of await this.repository.running()) {
      switch (run.status.kind) {
        case "project-command": {
          // A run started since The Office started, as the sweep goes on, is left running.
          if (this.commandRuns.isGoing(run.id)) break;
          await this.logs.note(run.id, stopWords(reason));
          await this.records.change(run.id, (kept) =>
            stoppedRun(kept, reason, this.schedule.now()),
          );
          break;
        }
        case "workflow":
          this.workflowRuns.resume(run);
          break;
        case "test-target":
          if (run.testInstanceId !== undefined) {
            await this.applyInstance(run.id, await this.testInstances.read(run.testInstanceId));
          }
          break;
      }
    }
    await this.commandRuns.sweep();
  }

  /** The run's masked log from byte `from` on: a Test target run's is its instance's. */
  async readLog(id: string, from: number): Promise<ActionRunLogRead> {
    const run = await this.read(id);
    const read =
      run.status.kind === "test-target" && run.testInstanceId !== undefined
        ? await this.testInstances.readLog(run.testInstanceId, from)
        : await this.logs.read(id, from);
    return { ...read, run };
  }

  /** Waits for the runs going on in the background, for a test. */
  settled(): Promise<void> {
    return this.background.settled();
  }

  /** The checks of the running runs and Actions at once, then the insert, one start at a time. */
  private async added(
    project: RunProject,
    action: RunAction,
    source: ResolvedSource,
    commit: string,
    by: ActionRunUser,
    targetThere: boolean,
  ): Promise<{ run: ActionRun; instance: RunTestInstance | undefined }> {
    const running = await this.repository.running();
    const now = this.schedule.now();
    const same = running.find(
      (run) => run.projectId === project.id && run.actionKey === action.key,
    );
    if (same !== undefined) throw new ActionRunRefused([runningAlready(same, now)]);
    if (action.kind === "project-command") {
      const commandRuns = running.filter((run) => run.status.kind === "project-command");
      const { actionsAtOnce } = await this.settings.read();
      if (commandRuns.length >= actionsAtOnce) {
        throw new ActionRunRefused([actionsAtOnceFull(commandRuns)]);
      }
    }
    const id = randomUUID();
    const instance =
      action.kind === "test-target" && targetThere
        ? await this.testInstances.launch(
            project.id,
            source.branch,
            action.settings.targetKey,
            by,
            {
              actionKey: action.key,
              actionName: action.name,
            },
          )
        : undefined;
    const run = startedRun({
      id,
      projectId: project.id,
      actionKey: action.key,
      actionName: action.name,
      kind: action.kind,
      ranFrom: source.ranFrom,
      branch: source.branch,
      startCommit: commit,
      startedBy: by,
      at: now,
      ...(instance === undefined ? {} : { testInstanceId: instance.id }),
      ...(action.kind === "workflow" ? { workflowFile: action.settings.file } : {}),
    });
    try {
      await this.repository.add(run);
    } catch (error) {
      if (instance !== undefined) await this.testInstances.stop(instance.id).catch(() => undefined);
      if (!(error instanceof ActionRunningAlready)) throw error;
      const holding = (await this.repository.running()).find(
        (each) => each.projectId === project.id && each.actionKey === action.key,
      );
      throw new ActionRunRefused([
        holding === undefined ? error.message : runningAlready(holding, this.schedule.now()),
      ]);
    }
    return { run, instance };
  }

  /** The branch a source means, refused when no start may run from it. */
  private async resolved(project: RunProject, source: ActionRunSource): Promise<ResolvedSource> {
    switch (source.kind) {
      case "branch":
        return { branch: source.branch, ranFrom: { kind: "branch" }, chosen: source.branch };
      case "task": {
        const task = await this.sources.taskOf(source.taskId);
        if (task === undefined) throw new ActionRunRefused([noSuchTask(source.taskId)]);
        if (task.projectId !== project.id) {
          throw new ActionRunRefused([taskOfAnotherProject(task.title)]);
        }
        if (task.ended) throw new ActionRunRefused([taskEnded(task.title)]);
        if (task.branch === undefined) throw new ActionRunRefused([taskHasNoBranch(task.title)]);
        return {
          branch: task.branch,
          ranFrom: { kind: "task", taskId: task.id, title: task.title },
          chosen: `the Task «${task.title}»`,
        };
      }
      case "initiative": {
        const initiative = await this.sources.initiativeOf(source.initiativeId);
        if (initiative === undefined) {
          throw new ActionRunRefused([noSuchInitiative(source.initiativeId)]);
        }
        if (!initiative.active) throw new ActionRunRefused([initiativeNotActive(initiative.name)]);
        const onProject = initiative.branches.find(({ projectId }) => projectId === project.id);
        if (onProject === undefined) {
          throw new ActionRunRefused([initiativeHasNoBranch(initiative.name, project.name)]);
        }
        return {
          branch: onProject.branch,
          ranFrom: { kind: "initiative", initiativeId: initiative.id, name: initiative.name },
          chosen: `the Initiative «${initiative.name}»`,
        };
      }
    }
  }

  private async followInstance(move: TestInstanceMove): Promise<void> {
    const run = await this.repository.ofTestInstance(move.instanceId);
    if (run === undefined) return;
    if (move.commit !== undefined) {
      const { commit } = move;
      await this.records.change(run.id, (kept) => withCommit(kept, commit));
    }
    if (move.to !== undefined) {
      const { to } = move;
      const words = this.stoppingInstances.get(move.instanceId);
      const at = this.schedule.now();
      const changed = await this.records.change(run.id, (kept) =>
        testTargetMoved(
          kept,
          {
            to,
            failedReason: words ?? move.failedReason,
            stoppedByUser: move.stoppedByUser === true,
          },
          at,
        ),
      );
      if (changed !== undefined && !isRunning(changed)) {
        this.stoppingInstances.delete(move.instanceId);
      }
    }
  }

  /** The run follows its instance as it is now; answers the run changed, or undefined. */
  private async applyInstance(
    runId: string,
    instance: RunTestInstance,
  ): Promise<ActionRun | undefined> {
    const words = this.stoppingInstances.get(instance.id);
    const at = this.schedule.now();
    if (instance.commit !== undefined) {
      const { commit } = instance;
      await this.records.change(runId, (kept) => withCommit(kept, commit));
    }
    const changed = await this.records.change(runId, (kept) =>
      testTargetMoved(
        kept,
        {
          to: instance.state,
          failedReason: words ?? instance.failedReason,
          stoppedByUser: words !== undefined,
        },
        at,
      ),
    );
    if (changed !== undefined && !isRunning(changed)) this.stoppingInstances.delete(instance.id);
    return changed ?? (await this.repository.find(runId));
  }

  private oneAtATime<Result>(step: () => Promise<Result>): Promise<Result> {
    const next = this.starting.then(step, step);
    this.starting = next.catch(() => undefined);
    return next;
  }
}
