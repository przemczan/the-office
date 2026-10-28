import { randomUUID } from "node:crypto";
import { Injectable, type OnModuleInit } from "@nestjs/common";
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
  type InitiativeChange,
} from "../domain/initiative-changes.js";
import { InitiativeNotFound } from "../domain/initiative-not-found.js";
import { InitiativeRefused } from "../domain/initiative-refused.js";
import { orderAfter } from "../domain/manual-order.js";
import { newTaskProblems, type NewTask, type Task } from "../domain/task.js";
import { TaskStateChanged } from "../domain/task-events.js";
import { IdeaRepository } from "../ports/idea-repository.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { KnownProjects } from "../ports/known-projects.js";
import { TaskRepository } from "../ports/task-repository.js";

/**
 * The Initiatives use cases: shaped from an Idea, confirmed, dropped, and done once their Tasks
 * are. Each change is saved first and its events published after.
 */
@Injectable()
export class InitiativeService implements OnModuleInit {
  constructor(
    private readonly repository: InitiativeRepository,
    private readonly ideas: IdeaRepository,
    private readonly tasks: TaskRepository,
    private readonly projects: KnownProjects,
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

  /** Makes the Idea an Initiative being shaped; the Idea's Attachments move to it. */
  async shape(ideaId: string, shapedBy: Author): Promise<Initiative> {
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

  /**
   * Every Initiative's Tasks, by the Initiative's id, from one read of the board, in the order they
   * were added, so the Projects it spans keep their order.
   */
  async tasksByInitiative(): Promise<ReadonlyMap<string, readonly Task[]>> {
    const byInitiative = new Map<string, Task[]>();
    const added = (await this.tasks.list()).toSorted(
      (one, other) =>
        one.createdAt.getTime() - other.createdAt.getTime() || one.id.localeCompare(other.id),
    );
    for (const task of added) {
      if (!task.initiativeId) continue;
      const tasks = byInitiative.get(task.initiativeId) ?? [];
      tasks.push(task);
      byInitiative.set(task.initiativeId, tasks);
    }
    return byInitiative;
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
