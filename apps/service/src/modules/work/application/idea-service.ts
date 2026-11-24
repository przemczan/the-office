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
  type IdeaTaskShaping,
  type IdeaChange,
} from "../domain/idea-changes.js";
import { IdeaNotFound } from "../domain/idea-not-found.js";
import { IdeaRefused } from "../domain/idea-refused.js";
import { orderAfter } from "../domain/manual-order.js";
import {
  historyOf,
  withIdeaEdits,
  type HistoryEntry,
  type RecordEdit,
} from "../domain/record-edits.js";
import type { Task } from "../domain/task.js";
import { IdeaRepository } from "../ports/idea-repository.js";
import { KnownProjects } from "../ports/known-projects.js";
import { RecordEdits } from "../ports/record-edits.js";

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
    private readonly edits: RecordEdits,
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

  /**
   * Its title, notes and Project, by `by`, each field that changed kept in its History. Refuses with
   * every reason, before saving, when the edit breaks a rule or the Idea is shaped.
   */
  async edit(id: string, given: IdeaEdit, by: Author): Promise<Idea> {
    if (given.projectId !== undefined && !(await this.projects.find(given.projectId))) {
      throw new IdeaRefused([...newIdeaProblems(given), unknownProject(given.projectId)]);
    }
    return this.update(id, (idea) => withIdeaEdits(editIdea(idea, given, new Date()), idea, by));
  }

  /** The Idea's History, oldest first: the edits of its fields, each with who made it. */
  async history(id: string): Promise<readonly HistoryEntry[]> {
    await this.read(id);
    return historyOf([], await this.edits.of({ kind: "idea", id }));
  }

  /** The Idea's kept edits, oldest first, each with who made it. */
  async editsOf(id: string): Promise<readonly RecordEdit[]> {
    return this.edits.of({ kind: "idea", id });
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
   * Makes the Idea a Task in Backlog in the Project, of the Kind given (a Feature by default), with
   * no Pipeline yet, last on the board; the Idea's Attachments move to the Task.
   */
  async shape(
    id: string,
    projectId: string,
    shapedBy: Author,
    given: Pick<IdeaTaskShaping, "kind" | "description"> = {},
  ): Promise<Task> {
    if (!(await this.projects.find(projectId))) throw new IdeaRefused([unknownProject(projectId)]);
    const taskId = randomUUID();
    const shaped = await this.repository.shape(id, (idea, attachments, takenOrders) => ({
      ...shapeIdeaIntoTask(
        idea,
        { id: taskId, projectId, ...given },
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
