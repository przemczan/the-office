import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Author } from "./author.js";
import { newIdeaProblems, trimmedNewIdea, type Idea, type IdeaEdit, type NewIdea } from "./idea.js";
import {
  IdeaCaptured,
  IdeaDropped,
  IdeaEdited,
  IdeaRestored,
  IdeaShaped,
  IdeaShapedIntoInitiative,
} from "./idea-events.js";
import { IdeaRefused } from "./idea-refused.js";
import type { Initiative } from "./initiative.js";
import type { InitiativeChange } from "./initiative-changes.js";
import { InitiativeCreated } from "./initiative-events.js";
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
    taskId: undefined,
    initiativeId: undefined,
    capturedBy,
    capturedAt,
    droppedAt: undefined,
  };
  return { idea, event: new IdeaCaptured(idea) };
}

/**
 * Changes the Idea's title, notes and Project until it is shaped: its Task or Initiative took them
 * then. Undefined when nothing changes; refuses with every reason.
 */
export function editIdea(
  idea: Idea,
  given: IdeaEdit,
  at: Date,
): IdeaChange<IdeaEdited> | undefined {
  const edit = trimmedNewIdea(given);
  const problems = [
    ...(idea.state === "shaped" ? [SHAPED_IDEA_NOT_EDITABLE] : []),
    ...newIdeaProblems(edit),
  ];
  if (problems.length > 0) throw new IdeaRefused(problems);
  if (edit.title === idea.title && edit.notes === idea.notes && edit.projectId === idea.projectId) {
    return undefined;
  }
  return { idea: { ...idea, ...edit }, event: new IdeaEdited(idea.id, at) };
}

const SHAPED_IDEA_NOT_EDITABLE = "A shaped Idea can't be edited; edit what it was shaped into.";

/** A shaped Idea and the Task it became, each with its event. */
export interface Shaping {
  readonly ideaShaped: IdeaChange<IdeaShaped>;
  readonly taskCreated: TaskChange<TaskCreated>;
}

/**
 * Makes a new Idea a Task in Backlog in the chosen Project, named after it, its notes the Task's
 * Description, and naming it as its origin; the Idea takes that Project. Its Attachments move with it (moveAttachment).
 */
export function shapeIdeaIntoTask(
  idea: Idea,
  task: { readonly id: string; readonly projectId: string },
  setting: Omit<NewTaskSetting, "originIdeaId" | "initiativeId">,
  at: Date,
): Shaping {
  refuseShaping(idea);
  const taskCreated = createTask(
    task.id,
    { title: idea.title, description: idea.notes, projectId: task.projectId, priority: "normal" },
    { ...setting, originIdeaId: idea.id, initiativeId: undefined },
    at,
  );
  return {
    ideaShaped: {
      idea: { ...idea, state: "shaped", projectId: task.projectId, taskId: task.id },
      event: new IdeaShaped(idea.id, task.projectId, task.id, at),
    },
    taskCreated,
  };
}

/** A shaped Idea and the Initiative it became, each with its event. */
export interface ShapingIntoInitiative {
  readonly ideaShaped: IdeaChange<IdeaShapedIntoInitiative>;
  readonly initiativeCreated: InitiativeChange<InitiativeCreated>;
}

/**
 * Makes a new Idea an Initiative being shaped, named after it and naming it as its origin, with no
 * outcome or Tasks yet; the Idea keeps its Project, if any, since an Initiative spans its Tasks'.
 * Its Attachments move with it (moveAttachment).
 */
export function shapeIdeaIntoInitiative(
  idea: Idea,
  initiativeId: string,
  shapedBy: Author,
  at: Date,
): ShapingIntoInitiative {
  refuseShaping(idea);
  const initiative: Initiative = {
    id: initiativeId,
    name: idea.title,
    outcome: "",
    state: "shaping",
    originIdeaId: idea.id,
    createdBy: shapedBy,
    createdAt: at,
    planningThreadIds: [],
    planningAutoMode: false,
    pipelines: [],
    branches: [],
  };
  return {
    ideaShaped: {
      idea: { ...idea, state: "shaped", initiativeId },
      event: new IdeaShapedIntoInitiative(idea.id, initiativeId, at),
    },
    initiativeCreated: { initiative, event: new InitiativeCreated(initiative) },
  };
}

/** Undefined when it is already dropped; a shaped Idea lives on as its Task's or Initiative's origin. */
export function dropIdea(idea: Idea, at: Date): IdeaChange<IdeaDropped> | undefined {
  if (idea.state === "dropped") return undefined;
  if (idea.state === "shaped") {
    throw new IdeaRefused([
      `A shaped Idea can't be dropped; drop its ${shapedIntoWord(idea)} instead.`,
    ]);
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

/** Why an Attachment can't be added to the Idea: a shaped one's Attachments went to what it became. */
export function attachingToIdeaProblems(idea: Idea): string[] {
  if (idea.state !== "shaped") return [];
  const word = shapedIntoWord(idea);
  return [
    `This Idea was shaped into ${word === "Task" ? "a" : "an"} ${word}; add the Attachment to the ${word}.`,
  ];
}

function refuseShaping(idea: Idea): void {
  if (idea.state === "shaped") throw new IdeaRefused(["This Idea is already shaped."]);
  if (idea.state === "dropped") {
    throw new IdeaRefused(["A dropped Idea can't be shaped; restore it first."]);
  }
}

function shapedIntoWord(idea: Idea): "Task" | "Initiative" {
  return idea.initiativeId === undefined ? "Task" : "Initiative";
}
