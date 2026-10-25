import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Author } from "./author.js";
import { newIdeaProblems, trimmedNewIdea, type Idea, type NewIdea } from "./idea.js";
import { IdeaCaptured, IdeaDropped, IdeaRestored, IdeaShaped } from "./idea-events.js";
import { IdeaRefused } from "./idea-refused.js";
import { createTask, type NewTaskSetting, type TaskChange } from "./task-changes.js";
import type { TaskCreated } from "./task-events.js";

/** An Idea after a change, with the event that announces it. */
export interface IdeaChange<Event extends DomainEvent> {
  readonly idea: Idea;
  readonly event: Event;
}

/** Refuses with every reason. */
export function captureIdea(
  id: string,
  given: NewIdea,
  capturedBy: Author,
  capturedAt: Date,
): IdeaChange<IdeaCaptured> {
  const newIdea = trimmedNewIdea(given);
  const problems = newIdeaProblems(newIdea);
  if (problems.length > 0) throw new IdeaRefused(problems);
  const idea: Idea = {
    id,
    ...newIdea,
    state: "new",
    capturedBy,
    capturedAt,
    droppedAt: undefined,
  };
  return { idea, event: new IdeaCaptured(idea) };
}

/** A shaped Idea and the Task it became, each with its event. */
export interface Shaping {
  readonly ideaShaped: IdeaChange<IdeaShaped>;
  readonly taskCreated: TaskChange<TaskCreated>;
}

/**
 * Makes a new Idea a Task in Backlog in the chosen Project, named after it and naming it as its
 * origin; the Idea takes that Project. Its Attachments move with it (moveAttachment).
 */
export function shapeIdeaIntoTask(
  idea: Idea,
  task: { readonly id: string; readonly projectId: string },
  setting: Omit<NewTaskSetting, "originIdeaId">,
  at: Date,
): Shaping {
  if (idea.state === "shaped") throw new IdeaRefused(["This Idea is already shaped."]);
  if (idea.state === "dropped") {
    throw new IdeaRefused(["A dropped Idea can't be shaped; restore it first."]);
  }
  const taskCreated = createTask(
    task.id,
    { title: idea.title, projectId: task.projectId, priority: "normal" },
    { ...setting, originIdeaId: idea.id },
    at,
  );
  return {
    ideaShaped: {
      idea: { ...idea, state: "shaped", projectId: task.projectId },
      event: new IdeaShaped(idea.id, task.projectId, task.id, at),
    },
    taskCreated,
  };
}

/** Undefined when it is already dropped; a shaped Idea lives on as its Task's origin. */
export function dropIdea(idea: Idea, at: Date): IdeaChange<IdeaDropped> | undefined {
  if (idea.state === "dropped") return undefined;
  if (idea.state === "shaped") {
    throw new IdeaRefused(["A shaped Idea can't be dropped; drop its Task instead."]);
  }
  return {
    idea: { ...idea, state: "dropped", droppedAt: at },
    event: new IdeaDropped(idea.id, at),
  };
}

/** Undefined when it is already new. */
export function restoreIdea(idea: Idea): IdeaChange<IdeaRestored> | undefined {
  if (idea.state === "new") return undefined;
  if (idea.state === "shaped") throw new IdeaRefused(["Only a dropped Idea can be restored."]);
  return {
    idea: { ...idea, state: "new", droppedAt: undefined },
    event: new IdeaRestored(idea.id),
  };
}

/** Why an Attachment can't be added to the Idea: a shaped one's Attachments went to its Task. */
export function attachingToIdeaProblems(idea: Idea): string[] {
  return idea.state === "shaped"
    ? ["This Idea was shaped into a Task; add the Attachment to the Task."]
    : [];
}
