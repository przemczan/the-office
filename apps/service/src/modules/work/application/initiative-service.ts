import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { moveAttachment } from "../domain/attachment-changes.js";
import type { Author } from "../domain/author.js";
import { shapeIdeaIntoInitiative } from "../domain/idea-changes.js";
import type { Initiative } from "../domain/initiative.js";
import {
  addTaskToInitiative,
  confirmInitiative,
  dropInitiative,
  finishInitiative,
  tasksByInitiative,
  type InitiativeChange,
} from "../domain/initiative-changes.js";
import { InitiativeNotFound } from "../domain/initiative-not-found.js";
import { InitiativeRefused } from "../domain/initiative-refused.js";
import { orderAfter } from "../domain/manual-order.js";
import { initiativeRecordText } from "../domain/record-words.js";
import { CTO, SHAPING_OPENING, SHAPING_THREAD_TITLE } from "../domain/shaping.js";
import { newTaskProblems, type NewTask, type Task } from "../domain/task.js";
import { TaskStateChanged } from "../domain/task-events.js";
import { AttachmentRepository } from "../ports/attachment-repository.js";
import { IdeaRepository } from "../ports/idea-repository.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { InitiativeThreads } from "../ports/initiative-threads.js";
import { KnownPeople } from "../ports/known-people.js";
import { KnownProjects } from "../ports/known-projects.js";
import { TaskRepository } from "../ports/task-repository.js";

/**
 * The Initiatives use cases: shaped from an Idea, confirmed, dropped, and done once their Tasks
 * are. Each change is saved first and its events published after.
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

  /** A new Task in Backlog in the Initiative and the Project, following the Project's default Pipeline. */
  async addTask(id: string, given: NewTask, createdBy: Author): Promise<Task> {
    const project = await this.projects.find(given.projectId);
    if (!project) {
      throw new InitiativeRefused([
        ...newTaskProblems(given),
        `There is no Project "${given.projectId}".`,
      ]);
    }
    const { task, event } = await this.repository.addTask(id, (initiative, takenOrders) =>
      addTaskToInitiative(
        initiative,
        randomUUID(),
        given,
        { pipelineId: project.defaultPipeline, order: orderAfter(takenOrders), createdBy },
        new Date(),
      ),
    );
    await this.events.publish(event);
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
