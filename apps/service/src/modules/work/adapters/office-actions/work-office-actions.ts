import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  CHOOSE_TASK_ENGINE_ACTION,
  ONBOARD_PROJECT_ACTION,
  CONFIRM_INITIATIVE_ACTION,
  INITIATIVE_BACK_TO_SHAPING_ACTION,
  PAUSE_INITIATIVE_ACTION,
  PLAN_IDEA_AS_TASK_ACTION,
  RESUME_INITIATIVE_ACTION,
  SET_INITIATIVE_ENGINE_ACTION,
  SOUND_FIRE_ALARM_ACTION,
  SHAPE_IDEA_INTO_INITIATIVE_ACTION,
  SHAPE_IDEA_INTO_TASK_ACTION,
  START_READY_TASKS_ACTION,
  WRITE_INITIATIVE_SHORT_NAME_ACTION,
  CHOOSE_TASK_PIPELINE_ACTION,
  CONFIRM_TASK_DEFINITION_OF_DONE_ACTION,
  CONFIRM_TASK_PLAN_ACTION,
  DELETE_VIEW_ACTION,
  MAKE_A_PLAN_ACTION,
  MARK_TASK_READY_ACTION,
  MOVE_TASK_ACTION,
  MOVE_TO_TOP_OF_QUEUE_ACTION,
  MOVE_UP_IN_QUEUE_ACTION,
  PAUSE_TASK_ACTION,
  PLACE_TASK_ACTION,
  PLAN_WITH_ACTION,
  RESOLVE_CONFLICTS_ACTION,
  RESUME_TASK_ACTION,
  SAVE_VIEW_ACTION,
  START_TASK_ACTION,
  STOP_TASK_ACTION,
  TAKE_OUT_OF_QUEUE_ACTION,
  ADD_DEPENDENCY_ACTION,
  ADD_TASK_ACTION,
  ADD_TO_INITIATIVE_ACTION,
  CHOOSE_PIPELINE_ACTION,
  ATTACH_LINK_ACTION,
  WRITE_COMMIT_MESSAGE_ACTION,
  ARCHIVE_INITIATIVE_ACTION,
  ARCHIVE_TASK_ACTION,
  CHANGE_TASK_DEFINITION_OF_DONE_ACTION,
  CHANGE_TASK_DESCRIPTION_ACTION,
  CHANGE_TASK_KIND_ACTION,
  CHANGE_TASK_PLAN_ACTION,
  CHANGE_TASK_PRIORITY_ACTION,
  CHANGE_TASK_TITLE_ACTION,
  DROP_IDEA_ACTION,
  DROP_INITIATIVE_ACTION,
  DROP_TASK_ACTION,
  EDIT_IDEA_ACTION,
  REMOVE_DEPENDENCY_ACTION,
  RESTORE_IDEA_ACTION,
  RESTORE_INITIATIVE_ACTION,
  REOPEN_TASK_ACTION,
  RESTORE_TASK_ACTION,
  START_TASK_OVER_ACTION,
  TAKE_OUT_OF_INITIATIVE_ACTION,
  WORK_OFFICE_ACTIONS,
  WRITE_INITIATIVE_OUTCOME_ACTION,
  type OfficeAction,
  type QueuedTask as QueuedTaskResponse,
} from "@the-office/contracts";
import type { z } from "zod";
import { officeActionDraft, officeActionTool, OfficeToolRegistry } from "../../../engine/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { IdeaService } from "../../application/idea-service.js";
import { FireAlarmService } from "../../application/fire-alarm-service.js";
import { InitiativeMembership } from "../../application/initiative-membership.js";
import {
  InitiativePause,
  type InitiativePauseOutcome,
} from "../../application/initiative-pause.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { InitiativeStart, type ReadyTasksStarted } from "../../application/initiative-start.js";
import { ConflictResolutions } from "../../application/conflict-resolutions.js";
import { OnboardingService } from "../../application/onboarding-service.js";
import { PlanningService } from "../../application/planning-service.js";
import { QueueService } from "../../application/queue-service.js";
import { SavedViewService } from "../../application/saved-view-service.js";
import { StartService } from "../../application/start-service.js";
import { TaskService } from "../../application/task-service.js";
import { TaskWaysBack } from "../../application/task-ways-back.js";
import type { Attachment } from "../../domain/attachment.js";
import type { Author } from "../../domain/author.js";
import type { FireAlarm, FireAlarmWay } from "../../domain/fire-alarm.js";
import type { Idea } from "../../domain/idea.js";
import type { OffBoardTaskStart } from "../../domain/off-board-task.js";
import type { Initiative } from "../../domain/initiative.js";
import { changeRouteOf } from "../../domain/initiative-changes.js";
import { pipelineIn } from "../../domain/initiative.js";
import type { Task } from "../../domain/task.js";
import { TASK_KIND_NAMES } from "../../domain/task-kind-words.js";
import { confirmationWords } from "../../domain/written-parts.js";
import type { DependencyChanges } from "../../domain/task-dependencies.js";
import { TaskDependencyRemoved } from "../../domain/task-events.js";
import { TASK_STATE_NAMES } from "../../domain/task-states.js";
import { SessionPeople } from "../../ports/session-people.js";
import {
  initiativePauseResponse,
  initiativeResponse,
  readyTasksStartedResponse,
} from "../http/initiative-response.js";
import { toOffBoardTaskStartResponse } from "../http/off-board-task-responses.js";
import { TaskResponses } from "../http/task-responses.js";
import {
  toAttachmentResponse,
  toFireAlarmResponse,
  toIdeaResponse,
  toQueueResponse,
  toSavedViewResponse,
} from "../http/work-responses.js";
import { attachedWords } from "../office-tools/attachment-office-tools.js";
import { WorkSubjectSnapshots } from "./work-subject-snapshots.js";
import { answered, personInSession } from "../office-tools/work-tool-answers.js";

/** The actions that shape an Initiative, named by its id, and those that shape one of its Tasks. */
const SHAPING_ACTIONS: ReadonlySet<string> = new Set([
  ADD_TASK_ACTION.name,
  CHOOSE_PIPELINE_ACTION.name,
  WRITE_INITIATIVE_OUTCOME_ACTION.name,
]);
const TASK_SHAPING_ACTIONS: ReadonlySet<string> = new Set([
  CHANGE_TASK_TITLE_ACTION.name,
  CHANGE_TASK_DESCRIPTION_ACTION.name,
]);

/**
 * One of Work's Office actions as Work carries it out: `handle` for the user's request and the
 * Agent's call alike, by `by`, its result answered to the web by `response` and worded to the Agent
 * by `words`.
 */
interface WorkActionHandler<Action extends OfficeAction, Result> {
  readonly action: Action;
  handle(input: z.output<Action["input"]>, by: Author): Promise<Result>;
  response(result: Result): Promise<z.input<Action["answer"]>>;
  words(result: Result, input: z.output<Action["input"]>): Promise<string>;
}

/** A handler with its action's types left behind, as the routes and tools look it up by name. */
type AnyWorkActionHandler = WorkActionHandler<OfficeAction, unknown>;

function handler<Action extends OfficeAction, Result>(
  each: WorkActionHandler<Action, Result>,
): AnyWorkActionHandler {
  return each as unknown as AnyWorkActionHandler;
}

/**
 * Work's Office actions (the Office action convention): the one handler of each action Work
 * declares, which its route (`WorkOfficeActionsController`) and its Office tool, registered here,
 * both call. Throws at start for a declared action with no handler.
 */
@Injectable()
export class WorkOfficeActions implements OnModuleInit {
  private readonly handlers: ReadonlyMap<string, AnyWorkActionHandler>;

  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly tasks: TaskService,
    private readonly waysBack: TaskWaysBack,
    private readonly planning: PlanningService,
    private readonly ideas: IdeaService,
    private readonly initiatives: InitiativeService,
    private readonly membership: InitiativeMembership,
    private readonly sessionPeople: SessionPeople,
    private readonly responses: TaskResponses,
    private readonly starting: StartService,
    private readonly queue: QueueService,
    private readonly conflictResolutions: ConflictResolutions,
    private readonly savedViews: SavedViewService,
    private readonly readyTasks: InitiativeStart,
    private readonly pausing: InitiativePause,
    private readonly attachments: AttachmentService,
    private readonly snapshots: WorkSubjectSnapshots,
    private readonly fireAlarm: FireAlarmService,
    private readonly onboarding: OnboardingService,
  ) {
    this.handlers = new Map(
      [
        this.onboardProject(),
        this.addDependency(),
        this.removeDependency(),
        this.addToInitiative(),
        this.addTask(),
        this.choosePipeline(),
        this.takeOutOfInitiative(),
        this.changeTaskTitle(),
        this.changeTaskDescription(),
        this.changeTaskKind(),
        this.changeTaskPriority(),
        this.changeTaskPlan(),
        this.changeTaskDefinitionOfDone(),
        this.writeCommitMessage(),
        this.attachLink(),
        this.dropTask(),
        this.archiveTask(),
        this.restoreTask(),
        this.startTaskOver(),
        this.reopenTask(),
        this.markTaskReady(),
        this.confirmTaskPlan(),
        this.confirmTaskDefinitionOfDone(),
        this.chooseTaskPipeline(),
        this.chooseTaskEngine(),
        this.placeTask(),
        this.makeAPlan(),
        this.planWith(),
        this.startTask(),
        this.pauseTask(),
        this.stopTask(),
        this.resumeTask(),
        this.moveTask(),
        this.takeOutOfQueue(),
        this.moveUpInQueue(),
        this.moveToTopOfQueue(),
        this.resolveConflicts(),
        this.saveView(),
        this.deleteView(),
        this.editIdea(),
        this.dropIdea(),
        this.restoreIdea(),
        this.writeInitiativeOutcome(),
        this.dropInitiative(),
        this.archiveInitiative(),
        this.restoreInitiative(),
        this.shapeIdeaIntoTask(),
        this.shapeIdeaIntoInitiative(),
        this.planIdeaAsTask(),
        this.confirmInitiative(),
        this.initiativeBackToShaping(),
        this.startReadyTasks(),
        this.pauseInitiative(),
        this.resumeInitiative(),
        this.setInitiativeEngine(),
        this.writeInitiativeShortName(),
        this.soundFireAlarm(),
      ].map((each) => [each.action.name, each]),
    );
    const unhandled = WORK_OFFICE_ACTIONS.filter(({ name }) => !this.handlers.has(name));
    if (unhandled.length > 0) {
      throw new Error(`No handler carries out ${unhandled.map(({ name }) => name).join(", ")}.`);
    }
  }

  onModuleInit(): void {
    for (const each of this.handlers.values()) {
      this.registry.register(
        officeActionTool(
          each.action,
          (input, { sessionId, allowedBy }) =>
            answered(async () => {
              const result = await each.handle(
                input,
                await personInSession(this.sessionPeople, sessionId, allowedBy),
              );
              return each.words(result, input);
            }),
          {
            floor: (input) => this.floorOf(each.action.name, input),
            draft: async (input) =>
              officeActionDraft(
                each.action,
                input,
                await this.snapshots.of(each.action.subject(input)),
              ),
            applyFor: (input, { user, proposedBy }) =>
              answered(async () =>
                each.words(await each.handle(input, { kind: "user", user, proposedBy }), input),
              ),
          },
        ),
      );
    }
  }

  /**
   * Whether a person's call is ruled no more freely than Proposal (spec 2.1.4: once an Initiative
   * is active, each change to it is a Proposal): a shaping call on an active Initiative, or on a
   * Task of one.
   */
  private async floorOf(name: string, input: unknown): Promise<"proposal" | undefined> {
    const initiativeId = await this.shapedInitiativeOf(name, input);
    if (initiativeId === undefined) return undefined;
    return (await this.initiatives.read(initiativeId)).state === "active" ? "proposal" : undefined;
  }

  private async shapedInitiativeOf(name: string, input: unknown): Promise<string | undefined> {
    const { initiativeId, taskId } = input as { initiativeId?: string; taskId?: string };
    if (SHAPING_ACTIONS.has(name)) return initiativeId;
    if (!TASK_SHAPING_ACTIONS.has(name) || taskId === undefined) return undefined;
    return (await this.tasks.read(taskId)).initiativeId;
  }

  /** The route's answer to the action, carried out for the signed-in user `by`. */
  async answer(action: OfficeAction, input: unknown, by: Author): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`Work carries out no Office action ${action.name}.`);
    return await each.response(await each.handle(input as never, by));
  }

  /** Onboard, and Onboard again: started or queued at once, the open one while there is one. */
  private onboardProject(): AnyWorkActionHandler {
    return handler({
      action: ONBOARD_PROJECT_ACTION,
      handle: ({ projectId }, by) => this.onboarding.onboard(projectId, by),
      response: async (start: OffBoardTaskStart) => toOffBoardTaskStartResponse(start),
      words: async (start: OffBoardTaskStart) =>
        start.outcome === "refused"
          ? `Onboarding was refused, with nothing made: ${start.reasons.join(" ")}`
          : `The Onboard Task "${start.offBoardTask.title}" is ${start.outcome === "in-flight" ? "already open" : start.outcome}.`,
    });
  }

  /** As the user's Mark Ready, with their answer to the dialog that names what is missing. */
  private markTaskReady(): AnyWorkActionHandler {
    return handler({
      action: MARK_TASK_READY_ACTION,
      handle: ({ taskId, confirmPlanAndDefinitionOfDone }, by) =>
        this.planning.markReady(taskId, by, { confirmPlanAndDefinitionOfDone }),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" is Ready now.`,
    });
  }

  private confirmTaskPlan(): AnyWorkActionHandler {
    return handler({
      action: CONFIRM_TASK_PLAN_ACTION,
      handle: ({ taskId }) => this.planning.confirmPlan(taskId),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" has the Plan confirmed, ${stateWords(task)}.`,
    });
  }

  private confirmTaskDefinitionOfDone(): AnyWorkActionHandler {
    return handler({
      action: CONFIRM_TASK_DEFINITION_OF_DONE_ACTION,
      handle: ({ taskId }) => this.planning.confirmDefinitionOfDone(taskId),
      response: (task: Task) => this.responses.task(task),
      words: async (task) =>
        `"${task.title}" has the Definition of Done confirmed, ${stateWords(task)}.`,
    });
  }

  private chooseTaskPipeline(): AnyWorkActionHandler {
    return handler({
      action: CHOOSE_TASK_PIPELINE_ACTION,
      handle: ({ taskId, pipelineId }) => this.planning.confirmPipeline(taskId, pipelineId),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" follows the Pipeline as given now.`,
    });
  }

  private chooseTaskEngine(): AnyWorkActionHandler {
    return handler({
      action: CHOOSE_TASK_ENGINE_ACTION,
      handle: ({ taskId, engineId, people }) =>
        this.tasks.setEngine(taskId, engineId, people === undefined ? undefined : (people ?? [])),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" has the engine as given now.`,
    });
  }

  private placeTask(): AnyWorkActionHandler {
    return handler({
      action: PLACE_TASK_ACTION,
      handle: ({ taskId, above, below }) =>
        this.tasks.reorder(taskId, { above: above ?? undefined, below: below ?? undefined }),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" is placed on the board as given now.`,
    });
  }

  private makeAPlan(): AnyWorkActionHandler {
    return handler({
      action: MAKE_A_PLAN_ACTION,
      handle: ({ taskId, autoMode }, by) => this.planning.makeAPlan(taskId, autoMode, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" is in Planning, the Planner at work on it.`,
    });
  }

  private planWith(): AnyWorkActionHandler {
    return handler({
      action: PLAN_WITH_ACTION,
      handle: ({ taskId }, by) => this.planning.plan(taskId, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" is in Planning, its planning Thread open.`,
    });
  }

  /**
   * As the user's Start: In progress, or in the queue when only waits held it. `onUsageCaps` and
   * `onLimits` start it past its usage caps or the limits, so they are part of what
   * the person's call asks to approve.
   */
  private startTask(): AnyWorkActionHandler {
    return handler({
      action: START_TASK_ACTION,
      handle: async (
        { taskId, onOverlap, onUsageCaps, onLimits },
        by,
      ): Promise<StartedOrQueued> => {
        const starting = await this.starting.start(
          taskId,
          { onOverlap, usageCaps: onUsageCaps ?? "wait", limits: onLimits ?? "wait" },
          by,
        );
        if (starting.kind === "started") return { task: starting.change.task, queued: null };
        return { task: await this.tasks.read(taskId), queued: await this.queuedPlace(taskId) };
      },
      response: async ({ task, queued }: StartedOrQueued) => ({
        task: await this.responses.task(task),
        queued,
      }),
      words: async ({ task, queued }: StartedOrQueued) =>
        queued
          ? `"${task.title}" is in the queue, in place ${queued.place}: ${queued.reasons.join(" ")}`
          : `"${task.title}" is started, ${stateWords(task)}.`,
    });
  }

  private pauseTask(): AnyWorkActionHandler {
    return handler({
      action: PAUSE_TASK_ACTION,
      handle: ({ taskId }, by) => this.tasks.pause(taskId, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" is paused, ${stateWords(task)}.`,
    });
  }

  private stopTask(): AnyWorkActionHandler {
    return handler({
      action: STOP_TASK_ACTION,
      handle: ({ taskId }, by) => this.tasks.stop(taskId, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" is stopped, ${stateWords(task)}.`,
    });
  }

  private resumeTask(): AnyWorkActionHandler {
    return handler({
      action: RESUME_TASK_ACTION,
      handle: ({ taskId }, by) => this.tasks.resume(taskId, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" goes on, ${stateWords(task)}.`,
    });
  }

  private moveTask(): AnyWorkActionHandler {
    return handler({
      action: MOVE_TASK_ACTION,
      handle: ({ taskId, projectId }, by) => this.tasks.move(taskId, projectId, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" is in the other Project now, ${stateWords(task)}.`,
    });
  }

  private takeOutOfQueue(): AnyWorkActionHandler {
    return handler({
      action: TAKE_OUT_OF_QUEUE_ACTION,
      handle: ({ taskId }) => this.queue.takeOut(taskId),
      response: async () => ({}),
      words: async () => "The Task is out of the queue, still Ready.",
    });
  }

  private moveUpInQueue(): AnyWorkActionHandler {
    return handler({
      action: MOVE_UP_IN_QUEUE_ACTION,
      handle: ({ taskId }) => this.queue.moveUp(taskId),
      response: async () => ({}),
      words: async () => "The Task is one place up in the queue.",
    });
  }

  private moveToTopOfQueue(): AnyWorkActionHandler {
    return handler({
      action: MOVE_TO_TOP_OF_QUEUE_ACTION,
      handle: ({ taskId }) => this.queue.moveToTop(taskId),
      response: async () => ({}),
      words: async () => "The Task is first in the queue.",
    });
  }

  private resolveConflicts(): AnyWorkActionHandler {
    return handler({
      action: RESOLVE_CONFLICTS_ACTION,
      handle: async ({ taskId }, by): Promise<ResolvedConflicts> => {
        const { task, startRefusal } = await this.conflictResolutions.resolve(taskId, by);
        return {
          task,
          queued: await this.queuedPlace(task.id),
          startRefusal: startRefusal ?? null,
        };
      },
      response: async ({ task, queued, startRefusal }: ResolvedConflicts) => ({
        task: await this.responses.task(task),
        queued,
        startRefusal: startRefusal === null ? null : [...startRefusal],
      }),
      words: async ({ task, startRefusal }: ResolvedConflicts) =>
        startRefusal
          ? `The Conflict resolution Task "${task.title}" is Ready, as Start refused it: ${startRefusal.join(" ")}`
          : `The Conflict resolution Task "${task.title}" is ${stateWords(task)}.`,
    });
  }

  private saveView(): AnyWorkActionHandler {
    return handler({
      action: SAVE_VIEW_ACTION,
      handle: (given) => this.savedViews.save(given),
      response: async (view) => toSavedViewResponse(view),
      words: async (view) => `The view "${view.name}" is saved.`,
    });
  }

  private deleteView(): AnyWorkActionHandler {
    return handler({
      action: DELETE_VIEW_ACTION,
      handle: ({ id }) => this.savedViews.remove(id),
      response: async () => ({}),
      words: async () => "The view is deleted.",
    });
  }

  /** The Task's place in the queue, null when it isn't queued. */
  private async queuedPlace(taskId: string): Promise<QueuedTaskResponse | null> {
    const queued = toQueueResponse(await this.queue.list()).find((each) => each.taskId === taskId);
    return queued ?? null;
  }

  private addDependency(): AnyWorkActionHandler {
    return handler({
      action: ADD_DEPENDENCY_ACTION,
      handle: ({ taskId, blockerId }) => this.tasks.addDependency(taskId, blockerId),
      response: (changes: DependencyChanges) => this.responses.task(changes.task),
      words: (changes, { blockerId }) => this.dependencyWords(changes, blockerId),
    });
  }

  /**
   * What an added dependency came to, so the Agent knows: left out as the Task waits for the
   * blocker through another already, or added, with every direct wait it replaced.
   */
  private async dependencyWords(changes: DependencyChanges, blockerId: string): Promise<string> {
    const { task, changed, coveredBy } = changes;
    const blocker = await this.tasks.read(blockerId);
    if (coveredBy) {
      return `"${task.title}" already waits for "${blocker.title}" through "${coveredBy.title}", so no direct wait was added: a Task waits directly only for Tasks it doesn't already wait for through another Task.`;
    }
    if (changed.length === 0) return `"${task.title}" waits for "${blocker.title}" already.`;
    const removed = changed.flatMap((each) =>
      each.events.flatMap((event) =>
        event instanceof TaskDependencyRemoved
          ? [{ waiting: each.task, blockerId: event.blockerId }]
          : [],
      ),
    );
    const titles = new Map(
      (await this.tasks.findAll(removed.map((each) => each.blockerId))).map((each) => [
        each.id,
        each.title,
      ]),
    );
    const replaced = removed.map(
      ({ waiting, blockerId: removedId }) =>
        ` "${waiting.title}" no longer waits directly for "${titles.get(removedId) ?? removedId}": it waits for it through another Task it waits for.`,
    );
    return `"${task.title}" now waits for "${blocker.title}" to be Done.${replaced.join("")}`;
  }

  private removeDependency(): AnyWorkActionHandler {
    return handler({
      action: REMOVE_DEPENDENCY_ACTION,
      handle: ({ taskId, blockerId }) => this.tasks.removeDependency(taskId, blockerId),
      response: (task) => this.responses.task(task),
      words: async (task, { blockerId }) => {
        const blocker = await this.tasks.read(blockerId);
        return `"${task.title}" no longer waits for "${blocker.title}".`;
      },
    });
  }

  private addToInitiative(): AnyWorkActionHandler {
    return handler({
      action: ADD_TO_INITIATIVE_ACTION,
      handle: ({ initiativeId, taskId }, by) => this.membership.add(initiativeId, taskId, by),
      response: (task) => this.responses.task(task),
      words: async (task, { initiativeId }) =>
        `"${task.title}" is in the Initiative "${await this.initiativeName(initiativeId)}" now, ${stateWords(task)}.`,
    });
  }

  private takeOutOfInitiative(): AnyWorkActionHandler {
    return handler({
      action: TAKE_OUT_OF_INITIATIVE_ACTION,
      handle: ({ initiativeId, taskId }, by) => this.membership.takeOut(initiativeId, taskId, by),
      response: (task) => this.responses.task(task),
      words: async (task, { initiativeId }) =>
        `"${task.title}" is out of the Initiative "${await this.initiativeName(initiativeId)}" now, ${stateWords(task)}.`,
    });
  }

  /** The user's new Task, or a person's whose Initiative is shaping or the user applied. */
  private addTask(): AnyWorkActionHandler {
    return handler({
      action: ADD_TASK_ACTION,
      handle: ({ initiativeId, blockedBy, ...given }, by) =>
        this.initiatives.addTask(initiativeId, given, blockedBy, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) =>
        `Added the Task "${task.title}" (Task ${task.id}) in ${TASK_STATE_NAMES[task.state]} in ${task.projectId}${await this.waitingWords(task)}, on the Initiative's page.`,
    });
  }

  private async waitingWords(task: Task): Promise<string> {
    if (task.blockedBy.length === 0) return "";
    const blockers = await this.tasks.findAll([...task.blockedBy]);
    return `, waiting for ${blockers.map(({ title }) => `"${title}"`).join(" and ")}`;
  }

  private choosePipeline(): AnyWorkActionHandler {
    return handler({
      action: CHOOSE_PIPELINE_ACTION,
      handle: ({ initiativeId, projectId, pipelineId }, by) =>
        this.initiatives.choosePipeline(initiativeId, projectId, pipelineId, changeRouteOf(by)),
      response: (initiative: Initiative) => initiativeResponse(this.initiatives, initiative),
      words: async (initiative, { projectId }) =>
        pipelineIn(initiative, projectId) === undefined
          ? `The Initiative's Pipeline in ${projectId} is None, on its page: each of its Tasks there publishes on its own.`
          : `In ${projectId} the Initiative follows ${pipelineIn(initiative, projectId)} now${initiative.shortName ? `; its Short name is ${initiative.shortName}` : ""}.`,
    });
  }

  private async initiativeName(id: string): Promise<string> {
    return (await this.initiatives.read(id)).name;
  }

  private changeTaskTitle(): AnyWorkActionHandler {
    return handler({
      action: CHANGE_TASK_TITLE_ACTION,
      handle: async ({ taskId, title }, by) => {
        const before = await this.tasks.read(taskId);
        return { before, task: await this.tasks.changeTitle(taskId, title, by) };
      },
      response: ({ task }: TaskBeforeAndAfter) => this.responses.task(task),
      words: async ({ before, task }) =>
        before.title === task.title
          ? `"${task.title}" is titled so already.`
          : `"${before.title}" is titled "${task.title}" now.`,
    });
  }

  private changeTaskDescription(): AnyWorkActionHandler {
    return handler({
      action: CHANGE_TASK_DESCRIPTION_ACTION,
      handle: ({ taskId, description }, by) =>
        this.tasks.changeDescription(taskId, description, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" has the Description as given now.`,
    });
  }

  private changeTaskKind(): AnyWorkActionHandler {
    return handler({
      action: CHANGE_TASK_KIND_ACTION,
      handle: ({ taskId, kind }, by) => this.tasks.changeKind(taskId, kind, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" is a ${TASK_KIND_NAMES[task.kind]} now.`,
    });
  }

  private changeTaskPriority(): AnyWorkActionHandler {
    return handler({
      action: CHANGE_TASK_PRIORITY_ACTION,
      handle: ({ taskId, priority }, by) => this.tasks.changePriority(taskId, priority, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" has ${task.priority} priority now.`,
    });
  }

  /** As the user's Save on the Plan (PUT /tasks/:id/plan): Not confirmed once changed. */
  private changeTaskPlan(): AnyWorkActionHandler {
    return handler({
      action: CHANGE_TASK_PLAN_ACTION,
      handle: (writing, by) => this.planning.writePlan(writing.taskId, writing, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) =>
        `"${task.title}" has the Plan as given now, ${confirmationWords(task.planConfirmed)}, ${stateWords(task)}.`,
    });
  }

  /** As the user's Save on the Definition of Done: Not confirmed once changed. */
  private changeTaskDefinitionOfDone(): AnyWorkActionHandler {
    return handler({
      action: CHANGE_TASK_DEFINITION_OF_DONE_ACTION,
      handle: ({ taskId, definitionOfDone }, by) =>
        this.planning.writeDefinitionOfDone(taskId, definitionOfDone, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) =>
        `"${task.title}" has the Definition of Done as given now, ${confirmationWords(task.definitionOfDoneConfirmed)}, ${stateWords(task)}.`,
    });
  }

  private writeCommitMessage(): AnyWorkActionHandler {
    return handler({
      action: WRITE_COMMIT_MESSAGE_ACTION,
      handle: ({ taskId, message }) => this.tasks.changeCommitMessage(taskId, message),
      response: (task: Task) => this.responses.task(task),
      words: async (task) =>
        task.commitMessage === ""
          ? "Cleared the commit message: Publish takes the default, the Task's title with a short summary below it."
          : "Wrote the commit message onto the Task.",
    });
  }

  private attachLink(): AnyWorkActionHandler {
    return handler({
      action: ATTACH_LINK_ACTION,
      handle: ({ taskId, url, name }, by) =>
        this.attachments.addLink({ kind: "task", taskId }, { url, name: name ?? "" }, by),
      response: async (attachment: Attachment) => toAttachmentResponse(attachment),
      words: async (attachment) => attachedWords(attachment),
    });
  }

  /** The Task's Drop refuses a person's once it has started, in its own words (`dropTask`). */
  private dropTask(): AnyWorkActionHandler {
    return handler({
      action: DROP_TASK_ACTION,
      handle: ({ taskId, reason }, by) => this.tasks.drop(taskId, by, reason),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" is Dropped now.`,
    });
  }

  private archiveTask(): AnyWorkActionHandler {
    return handler({
      action: ARCHIVE_TASK_ACTION,
      handle: ({ taskId }, by) => this.tasks.archive(taskId, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) =>
        `"${task.title}" is in the Archive now, off the board, ${stateWords(task)}.`,
    });
  }

  private startTaskOver(): AnyWorkActionHandler {
    return handler({
      action: START_TASK_OVER_ACTION,
      handle: ({ taskId, to, resetBranch }, by) =>
        this.waysBack.startOver(taskId, to, resetBranch, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" is started over, ${stateWords(task)}.`,
    });
  }

  private reopenTask(): AnyWorkActionHandler {
    return handler({
      action: REOPEN_TASK_ACTION,
      handle: ({ taskId, to, resetBranch }, by) =>
        this.waysBack.reopen(taskId, to, resetBranch, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" is reopened, ${stateWords(task)}.`,
    });
  }

  private restoreTask(): AnyWorkActionHandler {
    return handler({
      action: RESTORE_TASK_ACTION,
      handle: ({ taskId }, by) => this.tasks.restore(taskId, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `"${task.title}" is back on the board now, ${stateWords(task)}.`,
    });
  }

  private editIdea(): AnyWorkActionHandler {
    return handler({
      action: EDIT_IDEA_ACTION,
      handle: ({ ideaId, title, notes, projectId }, by) =>
        this.ideas.edit(ideaId, { title, notes, projectId: projectId ?? undefined }, by),
      response: async (idea: Idea) => toIdeaResponse(idea),
      words: async (idea) => `The Idea "${idea.title}" reads as given now.`,
    });
  }

  private dropIdea(): AnyWorkActionHandler {
    return handler({
      action: DROP_IDEA_ACTION,
      handle: ({ ideaId }) => this.ideas.drop(ideaId),
      response: async (idea: Idea) => toIdeaResponse(idea),
      words: async (idea) => `The Idea "${idea.title}" is Dropped now.`,
    });
  }

  private restoreIdea(): AnyWorkActionHandler {
    return handler({
      action: RESTORE_IDEA_ACTION,
      handle: ({ ideaId }) => this.ideas.restore(ideaId),
      response: async (idea: Idea) => toIdeaResponse(idea),
      words: async (idea) => `The Idea "${idea.title}" is new again.`,
    });
  }

  /** The user's outcome, written straight: refused once the Initiative is no longer shaping. */
  private writeInitiativeOutcome(): AnyWorkActionHandler {
    return handler({
      action: WRITE_INITIATIVE_OUTCOME_ACTION,
      handle: ({ initiativeId, outcome }, by) =>
        this.initiatives.writeOutcome(initiativeId, outcome, changeRouteOf(by), by),
      response: (initiative: Initiative) => initiativeResponse(this.initiatives, initiative),
      words: async (initiative) =>
        `The Initiative "${initiative.name}" has the outcome as given now.`,
    });
  }

  /** The Initiative's Drop refuses a person's once one of its Tasks has started (`dropInitiative`). */
  private dropInitiative(): AnyWorkActionHandler {
    return handler({
      action: DROP_INITIATIVE_ACTION,
      handle: ({ initiativeId }, by) => this.initiatives.drop(initiativeId, by),
      response: (initiative: Initiative) => initiativeResponse(this.initiatives, initiative),
      words: async (initiative) => `The Initiative "${initiative.name}" is Dropped now.`,
    });
  }

  private archiveInitiative(): AnyWorkActionHandler {
    return handler({
      action: ARCHIVE_INITIATIVE_ACTION,
      handle: ({ initiativeId }, by) => this.initiatives.archive(initiativeId, by),
      response: (initiative: Initiative) => initiativeResponse(this.initiatives, initiative),
      words: async (initiative) =>
        `The Initiative "${initiative.name}" is in the Archive now, off the board, ${initiative.state}.`,
    });
  }

  private restoreInitiative(): AnyWorkActionHandler {
    return handler({
      action: RESTORE_INITIATIVE_ACTION,
      handle: ({ initiativeId }, by) => this.initiatives.restore(initiativeId, by),
      response: (initiative: Initiative) => initiativeResponse(this.initiatives, initiative),
      words: async (initiative) =>
        `The Initiative "${initiative.name}" is back on the board now, ${initiative.state}.`,
    });
  }

  /** A Task shaped from an Idea is in no Initiative. */
  private shapeIdeaIntoTask(): AnyWorkActionHandler {
    return handler({
      action: SHAPE_IDEA_INTO_TASK_ACTION,
      handle: ({ ideaId, projectId, kind, description }, by) =>
        this.ideas.shape(ideaId, projectId, by, {
          ...(kind !== undefined && { kind }),
          ...(description !== undefined && { description }),
        }),
      response: (task: Task) => this.responses.task(task),
      words: async (task) => `The Idea is Shaped: "${task.title}" is in Backlog now.`,
    });
  }

  private shapeIdeaIntoInitiative(): AnyWorkActionHandler {
    return handler({
      action: SHAPE_IDEA_INTO_INITIATIVE_ACTION,
      handle: ({ ideaId }, by) => this.initiatives.shape(ideaId, by),
      response: (initiative: Initiative) => initiativeResponse(this.initiatives, initiative),
      words: async (initiative) =>
        `The Idea is Shaped: the Initiative "${initiative.name}" is being shaped, with no Tasks yet.`,
    });
  }

  /** Opens the Planner's planning Thread on the new Task, as the user's Plan as a Task does. */
  private planIdeaAsTask(): AnyWorkActionHandler {
    return handler({
      action: PLAN_IDEA_AS_TASK_ACTION,
      handle: ({ ideaId, projectId }, by) => this.planning.shapeAndPlan(ideaId, projectId, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) =>
        `The Idea is Shaped: "${task.title}" is in Planning, its planning Thread open.`,
    });
  }

  private confirmInitiative(): AnyWorkActionHandler {
    return handler({
      action: CONFIRM_INITIATIVE_ACTION,
      handle: ({ initiativeId }, by) => this.initiatives.confirm(initiativeId, by),
      response: (initiative: Initiative) => initiativeResponse(this.initiatives, initiative),
      words: async (initiative) => {
        const { branches } = await initiativeResponse(this.initiatives, initiative);
        const made = branches.length
          ? ` Its branches: ${branches.map(({ projectId, branch }) => `${branch} (${projectId})`).join(", ")}.`
          : "";
        return `The Initiative "${initiative.name}" is confirmed, ${initiative.state}.${made}`;
      },
    });
  }

  private initiativeBackToShaping(): AnyWorkActionHandler {
    return handler({
      action: INITIATIVE_BACK_TO_SHAPING_ACTION,
      handle: ({ initiativeId }, by) => this.initiatives.backToShaping(initiativeId, by),
      response: (initiative: Initiative) => initiativeResponse(this.initiatives, initiative),
      words: async (initiative) => `The Initiative "${initiative.name}" is back to Shaping.`,
    });
  }

  private startReadyTasks(): AnyWorkActionHandler {
    return handler({
      action: START_READY_TASKS_ACTION,
      handle: ({ initiativeId }, by) => this.readyTasks.startReadyTasks(initiativeId, by),
      response: async (result: ReadyTasksStarted) => readyTasksStartedResponse(result),
      words: async ({ started, queued, refused }: ReadyTasksStarted) => {
        return [
          started.length ? `Started: ${titled(started)}.` : "Nothing started.",
          ...queued.map(
            ({ task, place, reasons }) =>
              `"${task.title}" is in the queue, in place ${place}: ${reasons.join(" ")}`,
          ),
          ...refused.map(
            ({ task, reasons }) => `"${task.title}" was refused: ${reasons.join(" ")}`,
          ),
        ].join(" ");
      },
    });
  }

  private pauseInitiative(): AnyWorkActionHandler {
    return handler({
      action: PAUSE_INITIATIVE_ACTION,
      handle: ({ initiativeId }, by) => this.pausing.pause(initiativeId, by),
      response: (outcome: InitiativePauseOutcome) =>
        initiativePauseResponse(this.initiatives, outcome),
      words: async ({ initiative, taskIds }: InitiativePauseOutcome) =>
        `The Initiative "${initiative.name}" is paused, with ${taskIds.length} of its Tasks paused.`,
    });
  }

  private resumeInitiative(): AnyWorkActionHandler {
    return handler({
      action: RESUME_INITIATIVE_ACTION,
      handle: ({ initiativeId }, by) => this.pausing.resume(initiativeId, by),
      response: (outcome: InitiativePauseOutcome) =>
        initiativePauseResponse(this.initiatives, outcome),
      words: async ({ initiative, taskIds }: InitiativePauseOutcome) =>
        `The Initiative "${initiative.name}" goes on, with ${taskIds.length} of its Tasks resumed.`,
    });
  }

  /** Takes no Author: the alarm keeps no History of who sounded it. */
  private soundFireAlarm(): AnyWorkActionHandler {
    return handler({
      action: SOUND_FIRE_ALARM_ACTION,
      handle: ({ way }) => this.fireAlarm.sound(way),
      response: async (alarm: FireAlarm) => toFireAlarmResponse(alarm),
      words: async (alarm: FireAlarm, { way }) =>
        alarm.on
          ? `The fire alarm is on, sounded ${FIRE_ALARM_WAY_WORDS[alarm.way]} since ${alarm.since.toISOString()}.`
          : `The fire alarm sounded ${FIRE_ALARM_WAY_WORDS[way]} is off already.`,
    });
  }

  /** Takes no Author and keeps no History: nothing to record. */
  private setInitiativeEngine(): AnyWorkActionHandler {
    return handler({
      action: SET_INITIATIVE_ENGINE_ACTION,
      handle: ({ initiativeId, engineId }) => this.initiatives.setEngine(initiativeId, engineId),
      response: (initiative: Initiative) => initiativeResponse(this.initiatives, initiative),
      words: async (initiative) =>
        `The Initiative "${initiative.name}" has the engine as given now.`,
    });
  }

  /** Takes no Author and keeps no History: nothing to record. */
  private writeInitiativeShortName(): AnyWorkActionHandler {
    return handler({
      action: WRITE_INITIATIVE_SHORT_NAME_ACTION,
      handle: ({ initiativeId, shortName }) =>
        this.initiatives.writeShortName(initiativeId, shortName),
      response: (initiative: Initiative) => initiativeResponse(this.initiatives, initiative),
      words: async (initiative) =>
        `The Initiative "${initiative.name}" has the Short name as given now.`,
    });
  }
}

const FIRE_ALARM_WAY_WORDS: Readonly<Record<FireAlarmWay, string>> = {
  asap: "ASAP",
  "after-stages": "after the current Stages",
  "after-tasks": "after the current Tasks",
};

/** A Task Start left started or queued, with its place in the queue when it is. */
interface StartedOrQueued {
  readonly task: Task;
  readonly queued: QueuedTaskResponse | null;
}

/** The Conflict resolution Task, and why Start refused it, if it did. */
interface ResolvedConflicts extends StartedOrQueued {
  readonly startRefusal: readonly string[] | null;
}

/** A Task as it was before an action and as the action left it. */
interface TaskBeforeAndAfter {
  readonly before: Task;
  readonly task: Task;
}

function titled(tasks: readonly Task[]): string {
  return tasks.map(({ title }) => `"${title}"`).join(", ");
}

function stateWords(task: Task): string {
  return `in ${TASK_STATE_NAMES[task.state]}`;
}
