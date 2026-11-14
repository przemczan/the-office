import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { moveAttachment } from "../domain/attachment-changes.js";
import type { Author } from "../domain/author.js";
import { newIdeaProblems, type Idea, type IdeaEdit, type NewIdea } from "../domain/idea.js";
import {
  captureIdea,
  dropIdea,
  editIdea,
  restoreIdea,
  shapeIdeaIntoTask,
  type IdeaChange,
} from "../domain/idea-changes.js";
import { IdeaNotFound } from "../domain/idea-not-found.js";
import { IdeaRefused } from "../domain/idea-refused.js";
import { orderAfter } from "../domain/manual-order.js";
import type { Task } from "../domain/task.js";
import { IdeaRepository } from "../ports/idea-repository.js";
import { KnownProjects } from "../ports/known-projects.js";

/**
 * The Ideas use cases: captured in seconds, then shaped into a Task or dropped. Each change is
 * saved first and its events published after.
 */
@Injectable()
export class IdeaService {
  constructor(
    private readonly repository: IdeaRepository,
    private readonly projects: KnownProjects,
    private readonly events: EventBus,
  ) {}

  /** Refuses with every reason, before saving, when the Idea breaks a rule. */
  async capture(given: NewIdea, capturedBy: Author): Promise<Idea> {
    if (given.projectId !== undefined && !(await this.projects.find(given.projectId))) {
      throw new IdeaRefused([...newIdeaProblems(given), unknownProject(given.projectId)]);
    }
    const { idea, event } = captureIdea(randomUUID(), given, capturedBy, new Date());
    await this.repository.add(idea);
    await this.events.publish(event);
    return idea;
  }

  /** Refuses with every reason, before saving, when the edit breaks a rule or the Idea is shaped. */
  async edit(id: string, given: IdeaEdit): Promise<Idea> {
    if (given.projectId !== undefined && !(await this.projects.find(given.projectId))) {
      throw new IdeaRefused([...newIdeaProblems(given), unknownProject(given.projectId)]);
    }
    return this.update(id, (idea) => editIdea(idea, given, new Date()));
  }

  async list(): Promise<readonly Idea[]> {
    return this.repository.list();
  }

  async read(id: string): Promise<Idea> {
    const idea = await this.repository.find(id);
    if (!idea) throw new IdeaNotFound(id);
    return idea;
  }

  /**
   * Makes the Idea a Task in Backlog in the Project, with no Pipeline yet, last on the board; the
   * Idea's Attachments move to the Task.
   */
  async shape(id: string, projectId: string, shapedBy: Author): Promise<Task> {
    if (!(await this.projects.find(projectId))) throw new IdeaRefused([unknownProject(projectId)]);
    const taskId = randomUUID();
    const shaped = await this.repository.shape(id, (idea, attachments, takenOrders) => ({
      ...shapeIdeaIntoTask(
        idea,
        { id: taskId, projectId },
        { order: orderAfter(takenOrders), createdBy: shapedBy },
        new Date(),
      ),
      moves: attachments.map((attachment) => moveAttachment(attachment, { kind: "task", taskId })),
    }));
    const events: DomainEvent[] = [
      shaped.taskCreated.event,
      shaped.ideaShaped.event,
      ...shaped.moves.map((move) => move.event),
    ];
    for (const event of events) await this.events.publish(event);
    return shaped.taskCreated.task;
  }

  async drop(id: string): Promise<Idea> {
    return this.update(id, (idea) => dropIdea(idea, new Date()));
  }

  async restore(id: string): Promise<Idea> {
    return this.update(id, restoreIdea);
  }

  private async update<Event extends DomainEvent>(
    id: string,
    change: (idea: Idea) => IdeaChange<Event> | undefined,
  ): Promise<Idea> {
    const { idea, event } = await this.repository.update(id, change);
    if (event) await this.events.publish(event);
    return idea;
  }
}

function unknownProject(projectId: string): string {
  return `There is no Project "${projectId}".`;
}
