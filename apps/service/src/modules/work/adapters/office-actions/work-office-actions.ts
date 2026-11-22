import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  ADD_DEPENDENCY_ACTION,
  ADD_TO_INITIATIVE_ACTION,
  REMOVE_DEPENDENCY_ACTION,
  TAKE_OUT_OF_INITIATIVE_ACTION,
  WORK_OFFICE_ACTIONS,
  type OfficeAction,
} from "@the-office/contracts";
import type { z } from "zod";
import { officeActionTool, OfficeToolRegistry } from "../../../engine/index.js";
import { InitiativeMembership } from "../../application/initiative-membership.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { TaskService } from "../../application/task-service.js";
import type { Author } from "../../domain/author.js";
import type { Task } from "../../domain/task.js";
import type { DependencyChanges } from "../../domain/task-dependencies.js";
import { TaskDependencyRemoved } from "../../domain/task-events.js";
import { TASK_STATE_NAMES } from "../../domain/task-states.js";
import { SessionPeople } from "../../ports/session-people.js";
import { TaskResponses } from "../http/task-responses.js";
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
}

function stateWords(task: Task): string {
  return `in ${TASK_STATE_NAMES[task.state]}`;
}
