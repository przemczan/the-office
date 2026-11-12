import { eq, sql } from "drizzle-orm";
import type { Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import type { Attachment, AttachmentOwner } from "../../domain/attachment.js";
import type { Idea } from "../../domain/idea.js";
import type { Initiative } from "../../domain/initiative.js";
import type { Task } from "../../domain/task.js";
import type { StateChange } from "../../domain/state-change.js";
import type { TaskChange } from "../../domain/task-changes.js";
import type { TaskCreated } from "../../domain/task-events.js";
import { TaskNotFound } from "../../domain/task-not-found.js";
import type { TaskUpdate } from "../../ports/task-repository.js";
import { attachments, ideas, initiatives, tasks, taskStateChanges } from "./work.schema.js";

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type IdeaRow = typeof ideas.$inferSelect;
export type InitiativeRow = typeof initiatives.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether `id` can name a row of a uuid-keyed table: Postgres fails a query by any other id, which
 * names no record, such as one an Agent mistyped.
 */
export function canBeRowId(id: string): boolean {
  return UUID.test(id);
}

/**
 * Holds the board's manual order until the transaction ends, so whatever writes an order key reads
 * the keys taken and saves its own before anyone else reads them.
 */
export async function holdManualOrder(transaction: Transaction): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('work.manual-order'))`);
}

/**
 * Holds the Office-wide Short names until the transaction ends, so whatever derives or writes one
 * reads those taken and saves its own before anyone else reads them; the unique index catches any
 * write that skips it.
 */
export async function holdShortNames(transaction: Transaction): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('work.short-names'))`);
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
  if (!canBeRowId(id)) throw new TaskNotFound(id);
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
  await keepStateChange(transaction, changed);
  return changed;
}

/** Inserts the new Task with its creation, the first of its kept state changes. */
export async function insertTask(
  transaction: Transaction,
  created: TaskChange<TaskCreated>,
): Promise<void> {
  await transaction.insert(tasks).values(toTaskRow(created.task));
  await keepStateChange(transaction, created);
}

/** Keeps the change's move between states with the Task, when it makes one. */
export async function keepStateChange(
  transaction: Transaction,
  { task, stateChange }: TaskChange<DomainEvent>,
): Promise<void> {
  if (!stateChange) return;
  await transaction.insert(taskStateChanges).values({
    taskId: task.id,
    fromState: stateChange.from ?? null,
    toState: stateChange.to,
    changedAt: stateChange.at,
    changedBy: stateChange.by,
  });
}

/** The Task's kept state changes, in the order they were saved. */
export async function stateChangesOf(
  database: Database | Transaction,
  taskId: string,
): Promise<StateChange[]> {
  const rows = await database
    .select()
    .from(taskStateChanges)
    .where(eq(taskStateChanges.taskId, taskId))
    .orderBy(taskStateChanges.id);
  return rows.map((row) => ({
    from: row.fromState ?? undefined,
    to: row.toState,
    at: row.changedAt,
    by: row.changedBy,
  }));
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
  return {
    ...initiative,
    endedAt: initiative.endedAt ?? null,
    archivedAt: initiative.archivedAt ?? null,
    restoredAt: initiative.restoredAt ?? null,
    planningThreadId: initiative.planningThreadId ?? null,
    pipelineId: initiative.pipelineId ?? null,
    shortName: initiative.shortName ?? null,
    branches: initiative.branches.map((branch) => ({
      ...branch,
      madeAt: branch.madeAt.toISOString(),
    })),
  };
}

export function toInitiative(row: InitiativeRow): Initiative {
  return {
    ...row,
    endedAt: row.endedAt ?? undefined,
    archivedAt: row.archivedAt ?? undefined,
    restoredAt: row.restoredAt ?? undefined,
    planningThreadId: row.planningThreadId ?? undefined,
    pipelineId: row.pipelineId ?? undefined,
    shortName: row.shortName ?? undefined,
    branches: row.branches.map((branch) => ({ ...branch, madeAt: new Date(branch.madeAt) })),
  };
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
    description: task.description,
    plan: task.plan,
    planConfirmed: task.planConfirmed,
    filesToChange: [...task.filesToChange],
    estimatedTokens: task.estimatedTokens ?? null,
    definitionOfDone: [...task.definitionOfDone],
    definitionOfDoneConfirmed: task.definitionOfDoneConfirmed,
    pipelineId: task.pipelineId ?? null,
    proposedPipeline: task.proposedPipeline ?? null,
    autoMode: task.autoMode,
    initiativePlanningThreadId: task.initiativePlanningThreadId ?? null,
    markedPlanned: task.markedPlanned,
    hasPlanningThread: task.hasPlanningThread,
    personRole: task.personRole ?? null,
    pausedByAlarm: task.pausedByAlarm,
    madeFor: task.madeFor ?? null,
    blockedBy: [...task.blockedBy],
    originIdeaId: task.originIdeaId ?? null,
    initiativeId: task.initiativeId ?? null,
    projectMoves: task.projectMoves.map((move) => ({ ...move, at: move.at.toISOString() })),
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    archivedAt: task.archivedAt ?? null,
    restoredAt: task.restoredAt ?? null,
    endedAt: task.endedAt ?? null,
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
    description: row.description,
    plan: row.plan,
    planConfirmed: row.planConfirmed,
    filesToChange: row.filesToChange,
    estimatedTokens: row.estimatedTokens ?? undefined,
    definitionOfDone: row.definitionOfDone,
    definitionOfDoneConfirmed: row.definitionOfDoneConfirmed,
    pipelineId: row.pipelineId ?? undefined,
    proposedPipeline: row.proposedPipeline ?? undefined,
    autoMode: row.autoMode,
    initiativePlanningThreadId: row.initiativePlanningThreadId ?? undefined,
    markedPlanned: row.markedPlanned,
    hasPlanningThread: row.hasPlanningThread,
    personRole: row.personRole ?? undefined,
    pausedByAlarm: row.pausedByAlarm,
    madeFor: row.madeFor ?? undefined,
    blockedBy: row.blockedBy,
    originIdeaId: row.originIdeaId ?? undefined,
    initiativeId: row.initiativeId ?? undefined,
    projectMoves: row.projectMoves.map((move) => ({ ...move, at: new Date(move.at) })),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    archivedAt: row.archivedAt ?? undefined,
    restoredAt: row.restoredAt ?? undefined,
    endedAt: row.endedAt ?? undefined,
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
    ? { ...fields, url: attachment.url, mediaType: null, size: null, text: null }
    : {
        ...fields,
        url: null,
        mediaType: attachment.mediaType,
        size: attachment.size,
        text: attachment.text,
      };
}

/**
 * The table's checks keep each row an Attachment of one owner, and a link or a file. A file not
 * judged yet is read as not text: the start judges every one before the service takes requests.
 */
export function toAttachment(row: AttachmentRow): Attachment {
  const fields = {
    id: row.id,
    owner: ownerOf(row),
    name: row.name,
    addedBy: row.addedBy,
    addedAt: row.addedAt,
  };
  if (row.kind === "link") return { ...fields, kind: row.kind, url: present(row.url) };
  return {
    ...fields,
    kind: row.kind,
    mediaType: present(row.mediaType),
    size: present(row.size),
    text: row.text ?? false,
  };
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
