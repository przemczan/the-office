import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskLocks } from "../../../platform/locks/task-locks.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { EngineModels, EngineReferenceLock, type EngineId } from "../../engine/index.js";
import type { Author, UserRef } from "../domain/author.js";
import { boardOrder, orderAfter } from "../domain/manual-order.js";
import { BY_THE_PIPELINE, type StateChange } from "../domain/state-change.js";
import {
  historyOf,
  withTaskEdits,
  type HistoryEntry,
  type RecordEdit,
} from "../domain/record-edits.js";
import type { DropReason } from "../domain/drop-reason.js";
import {
  newTaskProblems,
  type NewTask,
  type Priority,
  type Task,
  type TaskKind,
  type TaskSummary,
} from "../domain/task.js";
import {
  changeCausedBy,
  changeFoundInVersion,
  changeKind,
  changePriority,
  changeStartedTaskState,
  createTask,
  dropTask,
  dropTaskAsAnswered,
  type DropAnswer,
  pauseTask,
  pauseTaskForAlarm,
  pauseTaskForUsageWindow,
  reorderTask,
  restartTask,
  resumeTask,
  resumeTaskAtReset,
  resumeTaskFreedByUsageWindow,
  stopTask,
  taskWentOnOnStandIn,
  type NewTaskOrigin,
  type TaskChange,
} from "../domain/task-changes.js";
import type { EngineStandIn } from "../domain/stand-ins-at-start.js";
import { archiveTask, restoreTask } from "../domain/task-archive.js";
import { unfinishedPublishingTask } from "../domain/publishing-task.js";
import {
  blockingTasks,
  blockPublishingTask,
  dependencyChanges,
  removeDependency,
  type DependencyChanges,
} from "../domain/task-dependencies.js";
import {
  TaskResumed,
  type TaskMovedToProject,
  type TaskPaused,
  type UsageWindowRefusal,
} from "../domain/task-events.js";
import { isInitiativePaused } from "../domain/initiative-pause.js";
import { moveProblems, moveTask, type MoveGrounds } from "../domain/task-move.js";
import { changeCommitMessage, publishCommitMessage } from "../domain/task-commit-message.js";
import { changeDescription, changeTitle } from "../domain/task-description.js";
import { changeTags } from "../domain/task-tags.js";
import {
  changeTaskEngine,
  onTask,
  taskEngineMoves,
  type TaskPersonEngine,
} from "../domain/work-engine.js";
import { TaskNotFound } from "../domain/task-not-found.js";
import { TaskRefused } from "../domain/task-refused.js";
import {
  OPEN_STATES,
  STARTED_STATES,
  restartProblems,
  type WayBackHolds,
} from "../domain/task-states.js";
import { writtenParts, type WrittenPlanAndDefinitionOfDone } from "../domain/written-parts.js";
import {
  holdsAtStageBoundary,
  holdsResume,
  stopsEveryWalk,
  type FireAlarm,
} from "../domain/fire-alarm.js";
import { FireAlarmRepository } from "../ports/fire-alarm-repository.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { KnownProjects } from "../ports/known-projects.js";
import { ProjectWorktrees } from "../ports/project-worktrees.js";
import { RecordEdits } from "../ports/record-edits.js";
import { TaskRepository, type NeighbourIds, type TaskUpdate } from "../ports/task-repository.js";
import { publishDependencyChanges } from "./dependency-events.js";
import { engineOverrideProblems, taskPeopleProblems } from "./engine-override-choice.js";
import { TaskEngineChecks } from "./task-engine-checks.js";
import { InitiativeBranching } from "./initiative-branching.js";

/**
 * The Tasks a Task is linked to on the board: by waiting, by resolving a pull request's conflicts,
 * and by its Kind's links (Caused by, Duplicate of, Found while working on, and their other ends).
 */
export interface TaskDependencyLinks {
  readonly waitsFor: readonly Task[];
  readonly waitingForIt: readonly Task[];
  /** The Task whose pull request's conflicts it resolves, a Conflict resolution Task's. */
  readonly resolvesConflictsOf: Task | undefined;
  /** Its Conflict resolution Tasks, newest first. */
  readonly conflictsResolvedBy: readonly Task[];
  /** The Task whose work caused this Bug. */
  readonly causedBy: Task | undefined;
  /** The Bugs naming it as their Caused by, in the board's order. */
  readonly causedBugs: readonly Task[];
  /** The Task it was dropped as a duplicate of. */
  readonly duplicateOf: Task | undefined;
  /** The Tasks dropped as duplicates of it, in the board's order. */
  readonly duplicates: readonly Task[];
  /** The Task it was found while working on. */
  readonly foundWhileWorkingOn: Task | undefined;
}

/** The Tasks use cases. Each change is saved first and its event published after. */
@Injectable()
export class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly projects: KnownProjects,
    private readonly fireAlarm: FireAlarmRepository,
    private readonly worktrees: ProjectWorktrees,
    private readonly initiativeBranching: InitiativeBranching,
    private readonly initiatives: InitiativeRepository,
    private readonly events: EventBus,
    private readonly schedule: Schedule,
    private readonly taskLocks: TaskLocks,
    private readonly engineChecks: TaskEngineChecks,
    private readonly engineModels: EngineModels,
    private readonly engineReferences: EngineReferenceLock,
    private readonly edits: RecordEdits,
  ) {}

  /**
   * A new Task in Backlog, with no Pipeline yet, last on the board, with a Plan and a Definition of
   * Done, unconfirmed, when its creator writes both, and where it comes from: whether The Office
   * made it, a Bug's Caused by, and the Task it was found while working on. Refused when a linked
   * Task isn't there.
   */
  async create(
    given: NewTask,
    createdBy: Author,
    written?: WrittenPlanAndDefinitionOfDone,
    origin: NewTaskOrigin = {},
  ): Promise<Task> {
    if (!(await this.projects.find(given.projectId))) {
      const problems = [...newTaskProblems(given), ...writtenParts(written).problems];
      throw new TaskRefused([...problems, `There is no Project "${given.projectId}".`]);
    }
    for (const linked of [origin.causedBy, origin.foundWhileWorkingOn]) {
      if (linked !== undefined) await this.refuseUnknown(linked);
    }
    const { task, event } = await this.repository.create((takenOrders) =>
      createTask(
        randomUUID(),
        given,
        {
          ...origin,
          order: orderAfter(takenOrders),
          originIdeaId: undefined,
          initiativeId: undefined,
          createdBy,
        },
        new Date(),
        "backlog",
        written,
      ),
    );
    await this.events.publish(event);
    return task;
  }

  /**
   * The Tasks on the board, of the Project when one is given, none archived, without their long
   * texts, in the board's order: by priority, then by manual order. `read` gives one whole.
   */
  onTheBoard(projectId?: string): Promise<readonly TaskSummary[]> {
    return projectId === undefined
      ? this.repository.onTheBoard()
      : this.repository.onTheBoardIn(projectId);
  }

  /** The archived Tasks without their long texts, the one archived last first. */
  archived(): Promise<readonly TaskSummary[]> {
    return this.repository.archived();
  }

  /** The Project's Tasks, archived ones too, without their long texts, in no particular order. */
  inProject(projectId: string): Promise<readonly TaskSummary[]> {
    return this.repository.inProject(projectId);
  }

  /**
   * The Tasks at a desk: started and not yet Done or Dropped, each counting against the limits;
   * in the board's order.
   */
  started(): Promise<readonly TaskSummary[]> {
    return this.repository.summariesIn(STARTED_STATES);
  }

  /** The Tasks neither Done nor Dropped, started or not, archived ones too, in the board's order. */
  open(): Promise<readonly TaskSummary[]> {
    return this.repository.summariesIn(OPEN_STATES);
  }

  /** The Tasks a usage window holds Paused, whatever its engine, in no particular order. */
  pausedByUsageWindow(): Promise<readonly TaskSummary[]> {
    return this.repository.pausedByUsageWindow();
  }

  /** The Tasks on one of these Pipelines, archived ones too, in no particular order. */
  onPipelines(pipelineIds: readonly string[]): Promise<readonly TaskSummary[]> {
    return this.repository.onPipelines(pipelineIds);
  }

  /** Every Tag on a Task, each once, in alphabetical order. */
  async tagsInUse(): Promise<string[]> {
    return [...(await this.repository.tagsInUse())].toSorted();
  }

  async read(id: string): Promise<Task> {
    const task = await this.repository.find(id);
    if (!task) throw new TaskNotFound(id);
    return task;
  }

  /** The Task, archived ones too, or undefined when there is none of that id. */
  async find(id: string): Promise<Task | undefined> {
    return this.repository.find(id);
  }

  /** Those of the Tasks there are, archived ones too, by their ids, in one read. */
  async findAll(ids: readonly string[]): Promise<readonly Task[]> {
    return ids.length === 0 ? [] : this.repository.findAll(ids);
  }

  /** The Tasks that moved to Done at or after `since`, each once, archived ones too. */
  async doneSince(since: Date): Promise<readonly string[]> {
    return this.repository.doneSince(since);
  }

  /** The Task's kept state changes, oldest first, each with who or what made it. */
  async stateChangesOf(taskId: string): Promise<readonly StateChange[]> {
    return this.repository.stateChangesOf(taskId);
  }

  /**
   * The Tasks it waits for, in the order they were added, and the Tasks that wait for it, in the
   * board's order; archived ones too.
   */
  async dependenciesOf(task: Task): Promise<TaskDependencyLinks> {
    const { dropReason } = task;
    const named = [
      ...task.blockedBy,
      ...[
        task.resolvesTaskId,
        task.causedBy,
        dropReason?.kind === "duplicate" ? dropReason.taskId : undefined,
        task.foundWhileWorkingOn,
      ].filter((id) => id !== undefined),
    ];
    const [naming, namedTasks] = await Promise.all([
      this.repository.linkedTo(task.id),
      this.findAll(named),
    ]);
    const byId = new Map(namedTasks.map((each) => [each.id, each]));
    const linked = (id: string | undefined) => (id === undefined ? undefined : byId.get(id));
    return {
      waitsFor: task.blockedBy.flatMap((id) => byId.get(id) ?? []),
      waitingForIt: naming.filter((each) => each.blockedBy.includes(task.id)).toSorted(boardOrder),
      resolvesConflictsOf:
        task.resolvesTaskId === undefined ? undefined : byId.get(task.resolvesTaskId),
      conflictsResolvedBy: naming
        .filter((each) => each.madeFor === "resolve-conflicts" && each.resolvesTaskId === task.id)
        .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      causedBy: linked(task.causedBy),
      causedBugs: naming.filter((each) => each.causedBy === task.id).toSorted(boardOrder),
      duplicateOf: linked(dropReason?.kind === "duplicate" ? dropReason.taskId : undefined),
      duplicates: naming
        .filter(
          ({ dropReason: reason }) => reason?.kind === "duplicate" && reason.taskId === task.id,
        )
        .toSorted(boardOrder),
      foundWhileWorkingOn: linked(task.foundWhileWorkingOn),
    };
  }

  /** The priority, by `by`, kept in the Task's History when it changes. */
  async changePriority(id: string, priority: Priority, by: Author): Promise<Task> {
    return this.update(id, (task) => withTaskEdits(changePriority(task, priority), task, by));
  }

  /** The title, in any state but Done and Dropped, by `by`, kept in the Task's History. */
  async changeTitle(id: string, title: string, by: Author): Promise<Task> {
    return this.update(id, (task) => withTaskEdits(changeTitle(task, title), task, by));
  }

  /**
   * Feature, Bug or Chore, in any state but Done and Dropped; the Task never moves for it. By `by`,
   * kept in the Task's History.
   */
  async changeKind(id: string, kind: TaskKind, by: Author): Promise<Task> {
    return this.update(id, (task) => withTaskEdits(changeKind(task, kind), task, by));
  }

  /**
   * The Task's engine override (spec 5.4.5), null for none, in any state but Done and Dropped;
   * refused for an engine Settings › Engines doesn't list, and with the capability check's reasons
   * when a Role of its Pipeline couldn't run on it. Saved with it, its setting for each person
   * (`people`: undefined keeps the saved ones, empty clears them), refused for a model or effort
   * the engine type doesn't offer, which no capability check weighs. Held under Engine's
   * `EngineReferenceLock` from reading the engines through the save, so a removal can't come in
   * between; the event is published after.
   */
  async setEngine(
    id: string,
    engineId: EngineId | null,
    people?: readonly TaskPersonEngine[],
  ): Promise<Task> {
    const { task, event } = await this.engineReferences.holding(async () => {
      const stored = await this.read(id);
      const change = changeTaskEngine(stored, engineId, people);
      if (!change) return { task: stored, event: undefined };
      const unlisted = [
        ...(await engineOverrideProblems(this.engineModels, engineId)),
        ...(await taskPeopleProblems(
          this.engineModels,
          change.task.peopleEngineSettings,
          stored.peopleEngineSettings,
        )),
      ];
      if (unlisted.length > 0) throw new TaskRefused(unlisted);
      const initiative =
        stored.initiativeId === undefined
          ? undefined
          : await this.initiatives.find(stored.initiativeId);
      const problems = await this.engineChecks.problemsOf({
        place: onTask(stored),
        moves: taskEngineMoves(stored, initiative?.engineOverride ?? null, engineId),
      });
      if (problems.length > 0) throw new TaskRefused([...problems]);
      return this.repository.update(id, (current) => changeTaskEngine(current, engineId, people));
    });
    if (event) await this.events.publish(event);
    return task;
  }

  /**
   * The Task whose work caused this Bug, another Task in any Project and state, archived ones too,
   * or undefined for none; in any state but Done and Dropped.
   */
  async changeCausedBy(id: string, causedBy: string | undefined): Promise<Task> {
    if (causedBy !== undefined && causedBy !== id) await this.refuseUnknown(causedBy);
    return this.update(id, (task) => changeCausedBy(task, causedBy));
  }

  /** The version the Bug was found in, free text, or undefined for none. */
  async changeFoundInVersion(id: string, foundInVersion: string | undefined): Promise<Task> {
    return this.update(id, (task) => changeFoundInVersion(task, foundInVersion));
  }

  /** The Description, until the Task starts, by `by`, kept in the Task's History. */
  async changeDescription(id: string, description: string, by: Author): Promise<Task> {
    return this.update(id, (task) => withTaskEdits(changeDescription(task, description), task, by));
  }

  /**
   * The Task's History, oldest first: its kept state changes and the edits of its fields, each with
   * who or what made it. Throws TaskNotFound when there is no such Task.
   */
  async history(id: string): Promise<readonly HistoryEntry[]> {
    await this.read(id);
    const [stateChanges, edits] = await Promise.all([
      this.repository.stateChangesOf(id),
      this.edits.of({ kind: "task", id }),
    ]);
    return historyOf(stateChanges, edits);
  }

  /** The Task's kept edits, oldest first, each with who made it. */
  async editsOf(id: string): Promise<readonly RecordEdit[]> {
    return this.edits.of({ kind: "task", id });
  }

  /**
   * The commit message Publish lands the Task as: the Planner's suggestion, an Agent Stage's update
   * or the user's, until the Task ends or Publish lands it.
   */
  async changeCommitMessage(id: string, message: string): Promise<Task> {
    return this.update(id, (task) => changeCommitMessage(task, message));
  }

  /** Publish landed the Task's commit message, which no longer changes from now on. */
  async markCommitMessagePublished(id: string): Promise<Task> {
    return this.update(id, (task) => publishCommitMessage(task, new Date()));
  }

  /** Sets the Task's Tags, in any state: the user's or the Planner's. */
  async changeTags(id: string, tags: readonly string[]): Promise<Task> {
    return this.update(id, (task) => changeTags(task, tags));
  }

  /** Places a Task that hasn't started between its neighbours in its column of the board. */
  async reorder(id: string, neighbourIds: NeighbourIds): Promise<Task> {
    const { task, event } = await this.repository.reorder(id, neighbourIds, reorderTask);
    if (event) await this.events.publish(event);
    return task;
  }

  /**
   * The Task waits for `blockerId` to be Done before it can start; any Task, in any Project. Only
   * when it doesn't wait for it through another Task already, and every direct wait the new one
   * covers is taken out, on it and on the Tasks waiting for it (dependencyChanges), all saved at
   * once and each link added or removed published after.
   */
  async addDependency(id: string, blockerId: string): Promise<DependencyChanges> {
    const changes = await this.repository.changeEveryDependency(id, (held, tasks) =>
      dependencyChanges(held, blockerId, tasks),
    );
    await publishDependencyChanges(this.events, changes);
    return changes;
  }

  async removeDependency(id: string, blockerId: string): Promise<Task> {
    const { task, event } = await this.repository.changeDependencies(id, (held) =>
      removeDependency(held, blockerId),
    );
    if (event) await this.events.publish(event);
    return task;
  }

  /**
   * Every reason the Task can't move to another Project now, and with `projectId`, to that one,
   * as its Initiative's Pipeline weighs it; empty when it can.
   */
  async moveProblems(id: string, projectId?: string): Promise<readonly string[]> {
    const task = await this.read(id);
    const problems = moveProblems(
      task,
      await this.moveGrounds(task, await this.stateChangesOf(id)),
    );
    if (projectId === undefined || task.initiativeId === undefined) return problems;
    return [
      ...problems,
      ...(await this.initiativeBranching.newProjectProblems(task.initiativeId, projectId)),
    ];
  }

  /**
   * Move, by `by`, the user: the Task goes to another Project, with no Pipeline there yet, refused with
   * every reason it can't. Its history and worktree are read holding the Task, so a planning or a
   * person's Thread that opens meanwhile either refuses the Move or finds the Task moved. A Ready
   * Task leaves Ready in the same save, published after the Move, as a changing Save publishes it.
   */
  async move(id: string, projectId: string, by: Author): Promise<Task> {
    if (!(await this.projects.find(projectId))) {
      throw new TaskRefused([`There is no Project "${projectId}".`]);
    }
    const { initiativeId } = await this.read(id);
    if (initiativeId !== undefined) {
      // Refused here before any branch is made; the hold below judges the Move again.
      const problems = await this.moveProblems(id);
      if (problems.length > 0) throw new TaskRefused([...problems]);
      await this.initiativeBranching.forNewProject(initiativeId, projectId);
    }
    const { task, event } = await this.repository.updateWithStateChanges(
      id,
      async (held, stateChanges) =>
        moveTask(held, projectId, await this.moveGrounds(held, stateChanges), by),
    );
    await this.publishMove(event);
    if (event && task.initiativeId !== undefined) {
      await this.blockPublishingTaskIn(task.initiativeId, projectId, task.id);
    }
    return task;
  }

  /**
   * A Task moved into a Project, or reopened in it, whose Publishing Task isn't Done or Dropped
   * becomes its blocker (spec 2.1, "Publishing Tasks"), judged again holding the Initiative and the
   * dependencies.
   */
  async blockPublishingTaskIn(
    initiativeId: string,
    projectId: string,
    blockerId: string,
  ): Promise<void> {
    const publishing = unfinishedPublishingTask(
      await this.repository.inInitiatives([initiativeId]),
      projectId,
    );
    if (!publishing) return;
    const { event } = await this.initiatives.changeDependencies(
      initiativeId,
      publishing.id,
      (_, held, tasks) =>
        held.projectId === projectId && unfinishedPublishingTask([held], projectId)
          ? blockPublishingTask(held, blockerId, tasks)
          : undefined,
    );
    if (event) await this.events.publish(event);
  }

  /** The Tasks still holding the Task back: its blockers neither Done nor Dropped, in order. */
  async waitingFor(id: string): Promise<readonly Task[]> {
    const task = await this.read(id);
    if (task.blockedBy.length === 0) return [];
    const blockers = new Map((await this.findAll(task.blockedBy)).map((each) => [each.id, each]));
    return blockingTasks(task.blockedBy.flatMap((blockerId) => blockers.get(blockerId) ?? []));
  }

  /**
   * Whether the Task is in the Project, read holding it: a Move holds it while it reads the
   * worktree, so one that found none has saved before this reads, or reads after a worktree made
   * before this call.
   */
  async isInProject(id: string, projectId: string): Promise<boolean> {
    const { task } = await this.repository.update(id, () => undefined);
    return task.projectId === projectId;
  }

  /**
   * Drops the Task, by the user (on its page, or by their answer to a Decision) or by a person
   * (drop_task, only before it starts), with the reason given, if any, kept with the move.
   */
  async drop(id: string, by: Author, reason?: DropReason): Promise<Task> {
    if (reason?.kind === "duplicate" && reason.taskId !== id)
      await this.refuseUnknown(reason.taskId);
    return this.update(id, (task) => dropTask(task, by, reason));
  }

  /**
   * Drops the Task as the answer to a Decision The Office put to the user or a duty holder, such as
   * a staffing Decision: a Consultant's answer Drops it even once started (spec 2.1.3, "Dropping").
   * Pipelines' answered Decisions call it; no route or Office action does.
   */
  async dropAsAnswered(id: string, answer: DropAnswer): Promise<Task> {
    return this.update(id, (task) => dropTaskAsAnswered(task, answer));
  }

  /** Takes a Done or Dropped Task off the board into the Archive, its state as it was. */
  async archive(id: string, by: Author): Promise<Task> {
    return this.update(id, (task) => archiveTask(task, new Date(), by));
  }

  /** Returns an archived Task to the board in the state it had. */
  async restore(id: string, by: Author): Promise<Task> {
    return this.update(id, (task) => restoreTask(task, new Date(), by));
  }

  /**
   * The user's Pause; TaskPaused tells Pipelines to hold its running Stage once the turn ends.
   */
  async pause(id: string, by: Author): Promise<Task> {
    return this.update(id, (task) => pauseTask(task, by));
  }

  /**
   * Holds the Task Paused as the user's Pause does, but by The Office, for a reason the walk can't
   * go on with, which its record gives.
   */
  async hold(id: string, reason: string): Promise<Task> {
    return this.update(id, (task) => pauseTask(task, { kind: "office", reason }));
  }

  /**
   * A pause by the usage window (spec §2.1): the Stage runner ended the run held as the engine
   * refused its turn, so TaskPaused by the usage window asks Pipelines for nothing; the Task resumes
   * at the window's reset (UsageWindowResumes). One paused by it already has its resume moved on.
   */
  async pauseForUsageWindow(id: string, refusal: UsageWindowRefusal): Promise<Task> {
    const now = this.schedule.now();
    return this.update(id, (task) => pauseTaskForUsageWindow(task, refusal, now));
  }

  /**
   * A running Stage of the Task went on on a Stand-in Engine (spec 5.4): the Task's entry for that
   * cascade's engine names it now, so the run's later Stages open on it; a Task no longer running
   * keeps its list.
   */
  async wentOnOnStandIn(id: string, standIn: EngineStandIn): Promise<Task> {
    return this.update(id, (task) => taskWentOnOnStandIn(task, standIn));
  }

  /**
   * The usage window's reset, for a Task it paused: resumed, so its Pipeline walks on where it was
   * held; while the fire alarm is on ASAP the alarm holds it instead, until the all clear. A Task the
   * user, the alarm or its Initiative holds by now, one a free reading resumed already
   * (`resumeFreedByUsageWindow`), or one whose reset moved on, stays as it is.
   */
  async resumeAtReset(id: string, now: Date): Promise<Task> {
    const alarmHoldsResume = await this.alarmStopsEveryWalk();
    return (
      await this.resumeFromUsageWindow(id, (held) =>
        resumeTaskAtReset(held, { alarmHoldsResume, now }),
      )
    ).task;
  }

  /**
   * A reading of `engineId`'s usage windows taken at `readAt` that Engine judged free: every Task
   * that engine's usage window paused before then resumes now, as at its reset, or is held by the
   * fire alarm while it is on ASAP. A Task paused before the engine was kept waits for its reset. Answers
   * the ids of the Tasks it took off the usage window.
   */
  async resumeFreedByUsageWindow(engineId: string, readAt: Date): Promise<readonly string[]> {
    const alarmHoldsResume = await this.alarmStopsEveryWalk();
    const freed: string[] = [];
    for (const { id } of await this.repository.pausedByUsageWindowOn(engineId)) {
      const { changed } = await this.resumeFromUsageWindow(id, (held) =>
        resumeTaskFreedByUsageWindow(held, { alarmHoldsResume, engineId, readAt }),
      );
      if (changed) freed.push(id);
    }
    return freed;
  }

  /**
   * Under the Task's lock, which the user's switch of a Stage waiting for a Stand-in Engine takes
   * too (Pipelines' `StandInSwitches`), so a click during the resume finds it resumed already.
   */
  private async resumeFromUsageWindow(
    id: string,
    change: (task: Task) => TaskChange<TaskResumed | TaskPaused> | undefined,
  ): Promise<{ readonly task: Task; readonly changed: boolean }> {
    return this.taskLocks.run(id, () => this.resumeFromUsageWindowNow(id, change));
  }

  private async resumeFromUsageWindowNow(
    id: string,
    change: (task: Task) => TaskChange<TaskResumed | TaskPaused> | undefined,
  ): Promise<{ readonly task: Task; readonly changed: boolean }> {
    const { task, event } = await this.repository.update(id, change);
    // Read again after the save, as a Resume does: an alarm sounded meanwhile passed it by as Paused.
    if (event instanceof TaskResumed && (await this.alarmStopsEveryWalk())) {
      return { task: await this.update(id, pauseTaskForAlarm), changed: true };
    }
    if (event) await this.events.publish(event);
    return { task, changed: event !== undefined };
  }

  /** Holds the Task now; TaskStopped tells Pipelines to interrupt the Stage running. */
  async stop(id: string, by: Author): Promise<Task> {
    return this.update(id, (task) => stopTask(task, by));
  }

  /**
   * TaskResumed tells Pipelines to walk the Task's Stages on from where they were held. While the
   * fire alarm is on ASAP, the alarm holds the Task instead, until the all clear; under a softer
   * way it walks on, and the walk holds it at its Stage boundary after the current Stages. A Task
   * the alarm paused is refused, as is one whose Initiative is paused.
   */
  async resume(id: string, by: Author): Promise<Task> {
    const alarm = await this.fireAlarm.read();
    const { task, event } = await this.resumeHeld(id, alarm, by);
    // Read again after the save: an alarm sounded meanwhile may have passed the Task by as Paused.
    if (event instanceof TaskResumed && (await this.alarmStopsEveryWalk())) {
      return this.update(id, pauseTaskForAlarm);
    }
    if (event) await this.events.publish(event);
    return task;
  }

  /**
   * What holds the Task beyond its own Pause or Stop now, for a way back (spec 2.4.5): its paused
   * Initiative, and the fire alarm holding a walk of it.
   */
  async wayBackHolds(task: Task): Promise<WayBackHolds> {
    const [alarm, initiative] = await Promise.all([
      this.fireAlarm.read(),
      task.initiativeId === undefined ? undefined : this.initiatives.find(task.initiativeId),
    ]);
    return {
      initiativePaused: initiative !== undefined && isInitiativePaused(initiative),
      alarmHoldsResume: holdsResume(alarm, task),
    };
  }

  /**
   * Why the user can't Restart from… the Task now (spec 2.4.5): it isn't Paused by their own Pause
   * or Stop, or the fire alarm, its engine's usage window or its paused Initiative holds it, worded
   * as Resume's refusals are. Empty when they can.
   */
  async restartProblems(id: string): Promise<readonly string[]> {
    const task = await this.read(id);
    return restartProblems(task, await this.wayBackHolds(task));
  }

  /**
   * The user's Restart from… `stageName`, which Pipelines has set the walk to go on from: the Paused
   * Task goes on In progress as a Resume does, TaskResumed telling Pipelines to walk on, its History
   * naming the Stage and the user. Refused as `restartProblems` says, judged again holding its
   * Initiative and the Task; an alarm sounded ASAP meanwhile holds it as it holds a Resume.
   */
  async restart(
    id: string,
    { stageName, by }: { readonly stageName: string; readonly by: UserRef },
  ): Promise<Task> {
    const alarm = await this.fireAlarm.read();
    const { task, event } = await this.changeWithItsInitiative(id, (held, initiativePaused) =>
      restartTask(
        held,
        { initiativePaused, alarmHoldsResume: holdsResume(alarm, held) },
        { stageName, user: by },
      ),
    );
    if (event && (await this.alarmStopsEveryWalk())) return this.update(id, pauseTaskForAlarm);
    if (event) await this.events.publish(event);
    return task;
  }

  /**
   * Pauses a Task In progress or Waiting on you as the fire alarm does, if it holds Tasks at their
   * Stage boundary (ASAP or after the current Stages): as the walk reaches one, and as The Office
   * starts again, for a sounding it stopped during. Whether it paused the Task.
   */
  async holdForFireAlarm(id: string): Promise<boolean> {
    if (!holdsAtStageBoundary(await this.fireAlarm.read())) return false;
    await this.update(id, pauseTaskForAlarm);
    return true;
  }

  /**
   * Moves a started Task along its Pipeline: Pipelines' interpreter calls it, Start never does. A
   * drop at a Gate brings the reason the user gave there, if any, kept with the move.
   */
  async changeState(id: string, state: Task["state"], dropReason?: DropReason): Promise<Task> {
    if (dropReason?.kind === "duplicate" && dropReason.taskId !== id) {
      await this.refuseUnknown(dropReason.taskId);
    }
    return this.update(id, (task) => {
      const change = changeStartedTaskState(task, state);
      if (!change || state !== "dropped" || !dropReason) return change;
      return dropTask(task, BY_THE_PIPELINE, dropReason);
    });
  }

  /** Refuses a link to a Task there is none of. */
  private async refuseUnknown(taskId: string): Promise<void> {
    if (!(await this.repository.find(taskId))) {
      throw new TaskRefused([`There is no Task ${taskId}.`]);
    }
  }

  private async moveGrounds(
    task: Task,
    stateChanges: MoveGrounds["stateChanges"],
  ): Promise<MoveGrounds> {
    return { stateChanges, hasWorktree: await this.worktrees.exists(task.projectId, task.id) };
  }

  private async publishMove(event: TaskMovedToProject | undefined): Promise<void> {
    if (!event) return;
    await this.events.publish(event);
    if (event.leftReady) await this.events.publish(event.leftReady);
  }

  private async resumeHeld(
    id: string,
    alarm: FireAlarm,
    by: Author,
  ): Promise<TaskUpdate<TaskResumed | TaskPaused>> {
    return this.changeWithItsInitiative(id, (held, initiativePaused) =>
      resumeTask(held, { alarmHoldsResume: holdsResume(alarm, held), initiativePaused }, by),
    );
  }

  /** Whether its Initiative is paused is read holding the Initiative, then the Task. */
  private async changeWithItsInitiative<Event extends DomainEvent>(
    id: string,
    change: (held: Task, initiativePaused: boolean) => TaskChange<Event> | undefined,
  ): Promise<TaskUpdate<Event>> {
    const { initiativeId } = await this.read(id);
    if (initiativeId === undefined) {
      return this.repository.update(id, (held) => change(held, false));
    }
    return this.initiatives.changeTask(initiativeId, id, (initiative, held) =>
      change(held, isInitiativePaused(initiative)),
    );
  }

  private async alarmStopsEveryWalk(): Promise<boolean> {
    return stopsEveryWalk(await this.fireAlarm.read());
  }

  private async update<Event extends DomainEvent>(
    id: string,
    change: (task: Task) => TaskChange<Event> | undefined,
  ): Promise<Task> {
    const { task, event } = await this.repository.update(id, change);
    if (event) await this.events.publish(event);
    return task;
  }
}
