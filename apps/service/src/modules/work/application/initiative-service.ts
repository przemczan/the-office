import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { moveAttachment } from "../domain/attachment-changes.js";
import type { Author } from "../domain/author.js";
import { shapeIdeaIntoInitiative } from "../domain/idea-changes.js";
import type { Initiative } from "../domain/initiative.js";
import {
  addCtoTask,
  addDependencyOfItsTask,
  addTaskToInitiative,
  confirmInitiative,
  dropInitiative,
  finishInitiative,
  removeDependencyOfItsTask,
  tasksByInitiative,
  writeOutcome,
  type InitiativeChange,
  type InitiativeChangeRoute,
} from "../domain/initiative-changes.js";
import {
  initiativeEditProblems,
  newTaskOf,
  type InitiativeEdit,
} from "../domain/initiative-edit.js";
import { InitiativeNotFound } from "../domain/initiative-not-found.js";
import { InitiativeNotShaping } from "../domain/initiative-not-shaping.js";
import { InitiativeRefused } from "../domain/initiative-refused.js";
import { orderAfter } from "../domain/manual-order.js";
import { initiativeRecordText } from "../domain/record-words.js";
import { CTO, SHAPING_OPENING, SHAPING_THREAD_TITLE } from "../domain/shaping.js";
import { newTaskProblems, type NewTask, type Task } from "../domain/task.js";
import type { TaskChange } from "../domain/task-changes.js";
import { createdWaitingFor } from "../domain/task-dependencies.js";
import { TaskStateChanged } from "../domain/task-events.js";
import { AttachmentRepository } from "../ports/attachment-repository.js";
import { IdeaRepository } from "../ports/idea-repository.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { InitiativeThreads } from "../ports/initiative-threads.js";
import { KnownPeople } from "../ports/known-people.js";
import { KnownProjects } from "../ports/known-projects.js";
import { ProposalDrafts } from "../ports/proposal-drafts.js";
import { TaskRepository } from "../ports/task-repository.js";

/** The CTO's change as written straight onto the Initiative, or drafted as a Proposal. */
export type CtoChange =
  { readonly kind: "written"; readonly edit: InitiativeEdit } | { readonly kind: "proposed" };

/**
 * The Initiatives use cases: shaped from an Idea, its outcome, Tasks and their dependencies written
 * while shaping or by the CTO's Proposals once active, confirmed, dropped, and done once their
 * Tasks are. Each change is saved first and its events published after.
 */
@Injectable()
export class InitiativeService implements OnModuleInit {
  private readonly logger = new Logger(InitiativeService.name);

  constructor(
    private readonly repository: InitiativeRepository,
    private readonly ideas: IdeaRepository,
    private readonly tasks: TaskRepository,
    private readonly attachments: AttachmentRepository,
    private readonly projects: KnownProjects,
    private readonly people: KnownPeople,
    private readonly threads: InitiativeThreads,
    private readonly proposals: ProposalDrafts,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    // A Task ending can leave every other one Done; a Dropped one no longer counts.
    this.events.subscribe(TaskStateChanged, async ({ taskId, to }) => {
      if (to !== "done" && to !== "dropped") return;
      const { initiativeId } = (await this.tasks.find(taskId)) ?? {};
      if (initiativeId) await this.finishIfDone(initiativeId);
    });
  }

  /**
   * Makes the Idea an Initiative being shaped, the Idea's Attachments moving to it, and opens its
   * shaping Thread when a CTO is hired. Without one the user writes it by hand, and starts its
   * Thread once a CTO is hired (spec §2.1 Defaults).
   */
  async shape(ideaId: string, shapedBy: Author): Promise<Initiative> {
    const initiative = await this.shapeFromIdea(ideaId, shapedBy);
    if (!(await this.people.find(CTO))) return initiative;
    // An Initiative stands without its Thread, so one that couldn't open leaves the user to start it.
    await this.openShapingThread(initiative.id).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`The Initiative ${initiative.id}'s shaping Thread couldn't open: ${reason}`);
    });
    return initiative;
  }

  /**
   * A new shaping Thread on the Initiative, where the CTO starts at once. Refused for a done or
   * dropped Initiative, and while nobody is the CTO.
   */
  async startShapingThread(id: string): Promise<{ readonly id: string }> {
    const initiative = await this.read(id);
    if (initiative.state === "done" || initiative.state === "dropped") {
      throw new InitiativeRefused([
        `The Initiative is ${initiative.state}: nothing is left to shape.`,
      ]);
    }
    if (!(await this.people.find(CTO))) {
      throw new InitiativeRefused([
        "Hire a CTO on People first: shaping is a conversation with them.",
      ]);
    }
    return this.openShapingThread(id);
  }

  private async openShapingThread(id: string): Promise<{ readonly id: string }> {
    return this.threads.startOnInitiative({
      initiativeId: id,
      roleKey: CTO,
      title: SHAPING_THREAD_TITLE,
      opening: SHAPING_OPENING,
    });
  }

  private async shapeFromIdea(ideaId: string, shapedBy: Author): Promise<Initiative> {
    const initiativeId = randomUUID();
    const shaped = await this.ideas.shapeIntoInitiative(ideaId, (idea, attachments) => ({
      ...shapeIdeaIntoInitiative(idea, initiativeId, shapedBy, new Date()),
      moves: attachments.map((attachment) =>
        moveAttachment(attachment, { kind: "initiative", initiativeId }),
      ),
    }));
    const events: DomainEvent[] = [
      shaped.initiativeCreated.event,
      shaped.ideaShaped.event,
      ...shaped.moves.map((move) => move.event),
    ];
    for (const event of events) await this.events.publish(event);
    return shaped.initiativeCreated.initiative;
  }

  /** Every Initiative, the newest first. */
  async list(): Promise<readonly Initiative[]> {
    return this.repository.list();
  }

  async read(id: string): Promise<Initiative> {
    const initiative = await this.repository.find(id);
    if (!initiative) throw new InitiativeNotFound(id);
    return initiative;
  }

  /** Every Initiative's Tasks, by the Initiative's id, from one read of the board (tasksByInitiative). */
  async tasksByInitiative(): Promise<ReadonlyMap<string, readonly Task[]>> {
    return tasksByInitiative(await this.tasks.list());
  }

  /**
   * The Initiative's record as an Agent reads it, in its Thread or mentioned in a chat. Throws
   * InitiativeNotFound when there is no such Initiative.
   */
  async recordText(id: string): Promise<string> {
    const initiative = await this.read(id);
    const [board, attachments] = await Promise.all([
      this.tasks.list(),
      this.attachments.listOf({ kind: "initiative", initiativeId: id }),
    ]);
    const tasks = tasksByInitiative(board).get(id) ?? [];
    const byId = new Map(board.map((task) => [task.id, task]));
    return initiativeRecordText(initiative, tasks, byId, attachments);
  }

  /** Makes it active; done at once when its Tasks already are. */
  async confirm(id: string): Promise<Initiative> {
    const confirmed = await this.update(id, confirmInitiative);
    return (await this.finishIfDone(id)) ?? confirmed;
  }

  async drop(id: string): Promise<Initiative> {
    return this.update(id, dropInitiative);
  }

  /**
   * What must be true once it is done: by the user, or by the CTO, straight onto it while it is
   * being shaped, or by Proposal.
   */
  async writeOutcome(
    id: string,
    outcome: string,
    route: InitiativeChangeRoute,
  ): Promise<Initiative> {
    return this.update(id, (initiative) => writeOutcome(initiative, outcome, route));
  }

  /**
   * The user's new Task in Backlog in the Initiative and the Project, following the Project's
   * default Pipeline, while the Initiative is shaping or active; it waits for `blockedBy` from the
   * start.
   */
  async addTask(
    id: string,
    given: NewTask,
    blockedBy: readonly string[],
    createdBy: Author,
  ): Promise<Task> {
    return this.createTask(id, given, createdBy, addTaskToInitiative, blockedBy);
  }

  /** The CTO's new Task, as `addTask`, by the route the change takes. */
  private async addCtoTask(
    id: string,
    given: NewTask,
    createdBy: Author,
    route: InitiativeChangeRoute,
  ): Promise<Task> {
    return this.createTask(id, given, createdBy, (initiative, ...made) =>
      addCtoTask(initiative, route, ...made),
    );
  }

  /** The CTO makes one of its Tasks wait for `blockerId`, any Task anywhere. */
  private async addDependencyOfItsTask(
    id: string,
    taskId: string,
    blockerId: string,
    route: InitiativeChangeRoute,
  ): Promise<Task> {
    return this.changeDependencies(id, taskId, (initiative, task, tasks) =>
      addDependencyOfItsTask(initiative, route, task, blockerId, tasks),
    );
  }

  private async removeDependencyOfItsTask(
    id: string,
    taskId: string,
    blockerId: string,
    route: InitiativeChangeRoute,
  ): Promise<Task> {
    return this.changeDependencies(id, taskId, (initiative, task) =>
      removeDependencyOfItsTask(initiative, route, task, blockerId),
    );
  }

  /**
   * Every reason a Proposal of `edit` would be refused if the user applied it now, in words the CTO
   * acts on: applying it judges again, under the Initiative's hold.
   */
  async problemsWithProposal(id: string, edit: InitiativeEdit): Promise<readonly string[]> {
    const initiative = await this.repository.find(id);
    if (!initiative) return [new InitiativeNotFound(id).message];
    if (edit.kind === "add-task" && !(await this.projects.find(edit.projectId))) {
      return [`There is no Project "${edit.projectId}".`];
    }
    return initiativeEditProblems(initiative, edit, await this.tasks.list());
  }

  /**
   * The CTO's change (spec §2.1 Defaults): straight onto the Initiative while it is being shaped;
   * once it is active, drafted as a Proposal in the Thread of `sessionId` for the user to apply,
   * refused with every reason applying it would be.
   */
  async changeByCto(
    id: string,
    edit: InitiativeEdit,
    cto: Author,
    sessionId: string,
  ): Promise<CtoChange> {
    try {
      return { kind: "written", edit: await this.applyEdit(id, edit, cto, "straight") };
    } catch (error) {
      if (!(error instanceof InitiativeNotShaping && error.state === "active")) throw error;
    }
    // Judged again here, outside the hold, as the Proposal's applier judges it while it is drafted.
    const problems = await this.problemsWithProposal(id, edit);
    if (problems.length > 0) throw new InitiativeRefused(problems);
    await this.proposals.draft(sessionId, { kind: "initiative", initiativeId: id, edit });
    return { kind: "proposed" };
  }

  /**
   * Carries out the CTO's Proposal the user applied, as proposed by `proposedBy`, and answers the
   * edit as applied: a new Task with its id. An edit that changes nothing now holds already.
   */
  async applyProposal(
    id: string,
    edit: InitiativeEdit,
    proposedBy: Author,
  ): Promise<InitiativeEdit> {
    return this.applyEdit(id, edit, proposedBy, "by-proposal");
  }

  private async applyEdit(
    id: string,
    edit: InitiativeEdit,
    cto: Author,
    route: InitiativeChangeRoute,
  ): Promise<InitiativeEdit> {
    switch (edit.kind) {
      case "outcome":
        await this.writeOutcome(id, edit.outcome, route);
        return edit;
      case "add-task": {
        const task = await this.addCtoTask(id, newTaskOf(edit), cto, route);
        return { ...edit, taskId: task.id };
      }
      case "add-dependency":
        await this.addDependencyOfItsTask(id, edit.taskId, edit.blockerId, route);
        return edit;
      case "remove-dependency":
        await this.removeDependencyOfItsTask(id, edit.taskId, edit.blockerId, route);
        return edit;
    }
  }

  private async createTask(
    id: string,
    given: NewTask,
    createdBy: Author,
    create: typeof addTaskToInitiative,
    blockedBy: readonly string[] = [],
  ): Promise<Task> {
    const project = await this.projects.find(given.projectId);
    if (!project) {
      throw new InitiativeRefused([
        ...newTaskProblems(given),
        `There is no Project "${given.projectId}".`,
      ]);
    }
    const { task, event } = await this.repository.addTask(id, (initiative, takenOrders, tasks) =>
      createdWaitingFor(
        create(
          initiative,
          randomUUID(),
          given,
          { pipelineId: project.defaultPipeline, order: orderAfter(takenOrders), createdBy },
          new Date(),
        ),
        blockedBy,
        tasks,
      ),
    );
    await this.events.publish(event);
    return task;
  }

  private async changeDependencies<Event extends DomainEvent>(
    id: string,
    taskId: string,
    change: (
      initiative: Initiative,
      task: Task,
      tasks: readonly Task[],
    ) => TaskChange<Event> | undefined,
  ): Promise<Task> {
    const { task, event } = await this.repository.changeDependencies(id, taskId, change);
    if (event) await this.events.publish(event);
    return task;
  }

  /** The Initiative once done, or undefined while it isn't. */
  private async finishIfDone(id: string): Promise<Initiative | undefined> {
    const { initiative, event } = await this.repository.update(id, finishInitiative);
    if (!event) return undefined;
    await this.events.publish(event);
    return initiative;
  }

  private async update<Event extends DomainEvent>(
    id: string,
    change: (initiative: Initiative) => InitiativeChange<Event> | undefined,
  ): Promise<Initiative> {
    const { initiative, event } = await this.repository.update(id, change);
    if (event) await this.events.publish(event);
    return initiative;
  }
}
