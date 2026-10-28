import { eq, sql } from "drizzle-orm";
import type { Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import type { Attachment, AttachmentOwner } from "../../domain/attachment.js";
import type { Idea } from "../../domain/idea.js";
import type { Initiative } from "../../domain/initiative.js";
import type { Task } from "../../domain/task.js";
import type { TaskChange } from "../../domain/task-changes.js";
import { TaskNotFound } from "../../domain/task-not-found.js";
import type { TaskUpdate } from "../../ports/task-repository.js";
import { attachments, ideas, initiatives, tasks } from "./work.schema.js";

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type IdeaRow = typeof ideas.$inferSelect;
export type InitiativeRow = typeof initiatives.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;

/**
 * Holds the board's manual order until the transaction ends, so whatever writes an order key reads
 * the keys taken and saves its own before anyone else reads them.
 */
export async function holdManualOrder(transaction: Transaction): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('work.manual-order'))`);
}

/**
 * Holds Starts until the transaction ends: each counts the started Tasks against the limits, so a
 * second must wait for the first to be saved.
 */
export async function holdStarts(transaction: Transaction): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('work.start'))`);
}

/** Holds changes of dependencies until the transaction ends, so two can't close a cycle at once. */
async function holdDependencies(transaction: Transaction): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('work.dependencies'))`);
}

/** Every Task, read holding every change of dependencies until the transaction ends. */
export async function everyTaskHoldingDependencies(transaction: Transaction): Promise<Task[]> {
  await holdDependencies(transaction);
  return everyTask(transaction);
}

/**
 * Applies `change` to the Task's dependencies in the transaction, holding every change of
 * dependencies and the Task meanwhile, with every Task read in the hold.
 */
export async function changeDependenciesHeld<Event extends DomainEvent>(
  transaction: Transaction,
  id: string,
  change: (task: Task, tasks: readonly Task[]) => TaskChange<Event> | undefined,
): Promise<TaskUpdate<Event>> {
  await holdDependencies(transaction);
  const task = await heldTask(transaction, id);
  return saveTask(transaction, task, change(task, await everyTask(transaction)));
}

async function everyTask(transaction: Transaction): Promise<Task[]> {
  return (await transaction.select().from(tasks)).map(toTask);
}

export async function heldTask(transaction: Transaction, id: string): Promise<Task> {
  const [row] = await transaction.select().from(tasks).where(eq(tasks.id, id)).for("update");
  if (!row) throw new TaskNotFound(id);
  return toTask(row);
}

/** Saves the Task as `changed` left it; nothing when it is undefined. */
export async function saveTask<Event extends DomainEvent>(
  transaction: Transaction,
  task: Task,
  changed: TaskChange<Event> | undefined,
): Promise<TaskUpdate<Event>> {
  if (!changed) return { task, event: undefined };
  await transaction.update(tasks).set(toTaskRow(changed.task)).where(eq(tasks.id, task.id));
  return changed;
}

/** Every Task's order key, but `besidesTaskId`'s. */
export async function takenOrders(
  transaction: Transaction,
  besidesTaskId?: string,
): Promise<string[]> {
  const rows = await transaction.select({ id: tasks.id, order: tasks.order }).from(tasks);
  return rows.filter((row) => row.id !== besidesTaskId).map((row) => row.order);
}

export function toIdeaRow(idea: Idea): IdeaRow {
  return {
    id: idea.id,
    title: idea.title,
    notes: idea.notes,
    projectId: idea.projectId ?? null,
    state: idea.state,
    taskId: idea.taskId ?? null,
    initiativeId: idea.initiativeId ?? null,
    capturedBy: idea.capturedBy,
    capturedAt: idea.capturedAt,
    droppedAt: idea.droppedAt ?? null,
  };
}

export function toIdea(row: IdeaRow): Idea {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    projectId: row.projectId ?? undefined,
    state: row.state,
    taskId: row.taskId ?? undefined,
    initiativeId: row.initiativeId ?? undefined,
    capturedBy: row.capturedBy,
    capturedAt: row.capturedAt,
    droppedAt: row.droppedAt ?? undefined,
  };
}

export function toInitiativeRow(initiative: Initiative): InitiativeRow {
  return { ...initiative };
}

export function toInitiative(row: InitiativeRow): Initiative {
  return { ...row };
}

export function toTaskRow(task: Task): TaskRow {
  return {
    id: task.id,
    title: task.title,
    projectId: task.projectId,
    state: task.state,
    priority: task.priority,
    tags: [...task.tags],
    order: task.order,
    plan: task.plan,
    planConfirmed: task.planConfirmed,
    definitionOfDone: [...task.definitionOfDone],
    definitionOfDoneConfirmed: task.definitionOfDoneConfirmed,
    pipelineId: task.pipelineId,
    proposedPipeline: task.proposedPipeline ?? null,
    personRole: task.personRole ?? null,
    isOnboardTask: task.isOnboardTask,
    blockedBy: [...task.blockedBy],
    originIdeaId: task.originIdeaId ?? null,
    initiativeId: task.initiativeId ?? null,
    createdBy: task.createdBy,
    createdAt: task.createdAt,
  };
}

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    projectId: row.projectId,
    state: row.state,
    priority: row.priority,
    tags: row.tags,
    order: row.order,
    plan: row.plan,
    planConfirmed: row.planConfirmed,
    definitionOfDone: row.definitionOfDone,
    definitionOfDoneConfirmed: row.definitionOfDoneConfirmed,
    pipelineId: row.pipelineId,
    proposedPipeline: row.proposedPipeline ?? undefined,
    personRole: row.personRole ?? undefined,
    isOnboardTask: row.isOnboardTask,
    blockedBy: row.blockedBy,
    originIdeaId: row.originIdeaId ?? undefined,
    initiativeId: row.initiativeId ?? undefined,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export function ownerColumns(
  owner: AttachmentOwner,
): Pick<AttachmentRow, "ideaId" | "initiativeId" | "taskId"> {
  return {
    ideaId: owner.kind === "idea" ? owner.ideaId : null,
    initiativeId: owner.kind === "initiative" ? owner.initiativeId : null,
    taskId: owner.kind === "task" ? owner.taskId : null,
  };
}

export function toAttachmentRow(attachment: Attachment): AttachmentRow {
  const fields = {
    id: attachment.id,
    ...ownerColumns(attachment.owner),
    kind: attachment.kind,
    name: attachment.name,
    addedBy: attachment.addedBy,
    addedAt: attachment.addedAt,
  };
  return attachment.kind === "link"
    ? { ...fields, url: attachment.url, mediaType: null, size: null }
    : { ...fields, url: null, mediaType: attachment.mediaType, size: attachment.size };
}

/** The table's checks keep each row an Attachment of one owner, and a link or a file. */
export function toAttachment(row: AttachmentRow): Attachment {
  const fields = {
    id: row.id,
    owner: ownerOf(row),
    name: row.name,
    addedBy: row.addedBy,
    addedAt: row.addedAt,
  };
  if (row.kind === "link") return { ...fields, kind: row.kind, url: present(row.url) };
  return { ...fields, kind: row.kind, mediaType: present(row.mediaType), size: present(row.size) };
}

function ownerOf(row: AttachmentRow): AttachmentOwner {
  if (row.ideaId !== null) return { kind: "idea", ideaId: row.ideaId };
  if (row.initiativeId !== null) return { kind: "initiative", initiativeId: row.initiativeId };
  return { kind: "task", taskId: present(row.taskId) };
}

function present<Value>(value: Value | null): Value {
  if (value === null) throw new Error("An attachments row breaks the table's checks.");
  return value;
}
