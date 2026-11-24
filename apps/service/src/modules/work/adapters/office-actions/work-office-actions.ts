import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  ADD_DEPENDENCY_ACTION,
  ADD_TO_INITIATIVE_ACTION,
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
  RESTORE_TASK_ACTION,
  TAKE_OUT_OF_INITIATIVE_ACTION,
  WORK_OFFICE_ACTIONS,
  WRITE_INITIATIVE_OUTCOME_ACTION,
  type OfficeAction,
} from "@the-office/contracts";
import type { z } from "zod";
import { officeActionTool, OfficeToolRegistry } from "../../../engine/index.js";
import { IdeaService } from "../../application/idea-service.js";
import { InitiativeMembership } from "../../application/initiative-membership.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { PlanningService } from "../../application/planning-service.js";
import { TaskService } from "../../application/task-service.js";
import type { Author } from "../../domain/author.js";
import type { Idea } from "../../domain/idea.js";
import type { Initiative } from "../../domain/initiative.js";
import type { Task } from "../../domain/task.js";
import { TASK_KIND_NAMES } from "../../domain/task-kind-words.js";
import { confirmationWords } from "../../domain/written-parts.js";
import type { DependencyChanges } from "../../domain/task-dependencies.js";
import { TaskDependencyRemoved } from "../../domain/task-events.js";
import { TASK_STATE_NAMES } from "../../domain/task-states.js";
import { SessionPeople } from "../../ports/session-people.js";
import { initiativeResponse } from "../http/initiative-response.js";
import { TaskResponses } from "../http/task-responses.js";
import { toIdeaResponse } from "../http/work-responses.js";
import { answered, personInSession } from "../office-tools/work-tool-answers.js";

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
    private readonly planning: PlanningService,
    private readonly ideas: IdeaService,
    private readonly initiatives: InitiativeService,
    private readonly membership: InitiativeMembership,
    private readonly sessionPeople: SessionPeople,
    private readonly responses: TaskResponses,
  ) {
    this.handlers = new Map(
      [
        this.addDependency(),
        this.removeDependency(),
        this.addToInitiative(),
        this.takeOutOfInitiative(),
        this.changeTaskTitle(),
        this.changeTaskDescription(),
        this.changeTaskKind(),
        this.changeTaskPriority(),
        this.changeTaskPlan(),
        this.changeTaskDefinitionOfDone(),
        this.dropTask(),
        this.archiveTask(),
        this.restoreTask(),
        this.editIdea(),
        this.dropIdea(),
        this.restoreIdea(),
        this.writeInitiativeOutcome(),
        this.dropInitiative(),
        this.archiveInitiative(),
        this.restoreInitiative(),
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
        officeActionTool(each.action, (input, { sessionId }) =>
          answered(async () => {
            const result = await each.handle(
              input,
              await personInSession(this.sessionPeople, sessionId),
            );
            return each.words(result, input);
          }),
        ),
      );
    }
  }

  /** The route's answer to the action, carried out for the signed-in user `by`. */
  async answer(action: OfficeAction, input: unknown, by: Author): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`Work carries out no Office action ${action.name}.`);
    return await each.response(await each.handle(input as never, by));
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
      handle: (writing, by) => this.planning.savePlan(writing.taskId, writing, by),
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
        this.planning.saveDefinitionOfDone(taskId, definitionOfDone, by),
      response: (task: Task) => this.responses.task(task),
      words: async (task) =>
        `"${task.title}" has the Definition of Done as given now, ${confirmationWords(task.definitionOfDoneConfirmed)}, ${stateWords(task)}.`,
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
        this.initiatives.writeOutcome(initiativeId, outcome, "straight", by),
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
}

/** A Task as it was before an action and as the action left it. */
interface TaskBeforeAndAfter {
  readonly before: Task;
  readonly task: Task;
}

function stateWords(task: Task): string {
  return `in ${TASK_STATE_NAMES[task.state]}`;
}
