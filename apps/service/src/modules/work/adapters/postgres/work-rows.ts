import { and, eq, getTableColumns, inArray, sql, type Column, type SQL } from "drizzle-orm";
import type { Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import type { Attachment, AttachmentOwner } from "../../domain/attachment.js";
import type { Author } from "../../domain/author.js";
import type { BranchDeletionRecord } from "../../domain/branch-deletion.js";
import type { DropReason } from "../../domain/drop-reason.js";
import type { Idea } from "../../domain/idea.js";
import type { Initiative } from "../../domain/initiative.js";
import type { Task, TaskSummary, TaskTextField } from "../../domain/task.js";
import type { PullRequestEnd } from "../../domain/task-pull-request.js";
import type { StateChange, StateChangeCause } from "../../domain/state-change.js";
import type { TaskChange } from "../../domain/task-changes.js";
import type { DependencyChange, DependencyChanges } from "../../domain/task-dependencies.js";
import type { TaskCreated } from "../../domain/task-events.js";
import { TaskNotFound } from "../../domain/task-not-found.js";
import { NOT_STARTED_STATES } from "../../domain/task-states.js";
import type { TaskUpdate } from "../../ports/task-repository.js";
import {
  attachments,
  ideas,
  initiatives,
  tasks,
  taskStateChanges,
  type AuthorRow,
  type PullRequestEndRow,
  type BranchDeletionRow,
  type StateChangeCauseRow,
} from "./work.schema.js";

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

/**
 * Applies `change`, an added dependency that may change several Tasks, in the transaction, holding
 * every change of dependencies and the Task meanwhile: the Task saved whole, every other Task's
 * dependencies alone, which change only in this hold, and none of a Task that started since it was
 * read. Answers the changes as saved.
 */
export async function changeEveryDependencyHeld(
  transaction: Transaction,
  id: string,
  change: (task: Task, tasks: readonly Task[]) => DependencyChanges,
): Promise<DependencyChanges> {
  await holdDependencies(transaction);
  const task = await heldTask(transaction, id);
  const changes = change(task, await everyTask(transaction));
  const saved: DependencyChange[] = [];
  for (const each of changes.changed) {
    if (each.task.id === task.id) {
      await transaction.update(tasks).set(taskRowUpdate(each.task)).where(eq(tasks.id, task.id));
      saved.push(each);
      continue;
    }
    const updated = await transaction
      .update(tasks)
      .set({ blockedBy: [...each.task.blockedBy] })
      .where(and(eq(tasks.id, each.task.id), inArray(tasks.state, [...NOT_STARTED_STATES])))
      .returning({ id: tasks.id });
    if (updated.length > 0) saved.push(each);
  }
  return { ...changes, changed: saved };
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
  await transaction.update(tasks).set(taskRowUpdate(changed.task)).where(eq(tasks.id, task.id));
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
    by: causeOf(row.changedBy),
  }));
}

/** A user's Author from before users existed names nobody until the first user claims it. */
export function authorOf(row: AuthorRow): Author {
  return row.kind === "user" ? { kind: "user", user: row.user ?? null } : row;
}

function causeOf(row: StateChangeCauseRow): StateChangeCause {
  switch (row.kind) {
    case "user":
    case "person":
      return authorOf(row);
    case "queue":
      return { kind: "queue", queuedBy: row.queuedBy ? authorOf(row.queuedBy) : null };
    default:
      return row;
  }
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
    capturedBy: authorOf(row.capturedBy),
    capturedAt: row.capturedAt,
    droppedAt: row.droppedAt ?? undefined,
  };
}

/** The Initiative as its row keeps it, all but the unread `model`, which an insert leaves null. */
export function toInitiativeRow({
  engineOverride,
  ...initiative
}: Initiative): WrittenInitiativeRow {
  return {
    ...initiative,
    engineId: engineOverride,
    originIdeaId: initiative.originIdeaId ?? null,
    endedAt: initiative.endedAt ?? null,
    archivedAt: initiative.archivedAt ?? null,
    archivedBy: initiative.archivedBy ?? null,
    restoredAt: initiative.restoredAt ?? null,
    restoredBy: initiative.restoredBy ?? null,
    pausedAt: initiative.pausedAt ?? null,
    planningThreadId: initiative.planningThreadId ?? null,
    planningThreadIds: [...initiative.planningThreadIds],
    planningStartedBy: initiative.planningStartedBy ?? null,
    pipelines: initiative.pipelines.map(({ projectId, pipelineId }) => ({
      projectId,
      pipelineId: pipelineId ?? null,
    })),
    shortName: initiative.shortName ?? null,
    branches: initiative.branches.map(({ deletion, ...branch }) => ({
      ...branch,
      madeAt: branch.madeAt.toISOString(),
      ...(deletion ? { deletion: toBranchDeletionRow(deletion) } : {}),
    })),
  };
}

export function toInitiative({ engineId, model: _model, ...row }: InitiativeRow): Initiative {
  return {
    ...row,
    engineOverride: engineId,
    originIdeaId: row.originIdeaId ?? undefined,
    createdBy: authorOf(row.createdBy),
    endedAt: row.endedAt ?? undefined,
    archivedAt: row.archivedAt ?? undefined,
    archivedBy: row.archivedBy ?? undefined,
    restoredAt: row.restoredAt ?? undefined,
    restoredBy: row.restoredBy ? authorOf(row.restoredBy) : undefined,
    pausedAt: row.pausedAt ?? undefined,
    planningThreadId: row.planningThreadId ?? undefined,
    planningStartedBy: row.planningStartedBy ? authorOf(row.planningStartedBy) : undefined,
    pipelines: row.pipelines.map(({ projectId, pipelineId }) => ({
      projectId,
      pipelineId: pipelineId ?? undefined,
    })),
    shortName: row.shortName ?? undefined,
    branches: row.branches.map(({ deletion, ...branch }) => ({
      ...branch,
      madeAt: new Date(branch.madeAt),
      ...(deletion ? { deletion: branchDeletionOf(deletion) } : {}),
    })),
  };
}

/** The Task as its row keeps it, all but the unread `model`, which an insert leaves null. */
export function toTaskRow(task: Task): WrittenTaskRow {
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
    commitMessage: task.commitMessage,
    commitMessagePublishedAt: task.commitMessagePublishedAt ?? null,
    pipelineId: task.pipelineId ?? null,
    proposedPipeline: task.proposedPipeline ?? null,
    autoMode: task.autoMode,
    initiativePlanningThreadId: task.initiativePlanningThreadId ?? null,
    markedPlanned: task.markedPlanned,
    hasPlanningThread: task.hasPlanningThread,
    personRole: task.personRole ?? null,
    engineStandIns: [...task.engineStandIns],
    pausedBy: task.pausedBy ?? null,
    resumesAt: task.resumesAt ?? null,
    usageWindowEngineId: task.usageWindowEngineId ?? null,
    usageWindowPausedAt: task.usageWindowPausedAt ?? null,
    madeFor: task.madeFor ?? null,
    resolvesTaskId: task.resolvesTaskId ?? null,
    blockedBy: [...task.blockedBy],
    originIdeaId: task.originIdeaId ?? null,
    initiativeId: task.initiativeId ?? null,
    projectMoves: task.projectMoves.map((move) => ({ ...move, at: move.at.toISOString() })),
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    archivedAt: task.archivedAt ?? null,
    archivedBy: task.archivedBy ?? null,
    restoredAt: task.restoredAt ?? null,
    restoredBy: task.restoredBy ?? null,
    endedAt: task.endedAt ?? null,
    pullRequestEnd: task.pullRequestEnd ? toPullRequestEndRow(task.pullRequestEnd) : null,
    branchDeletion: task.branchDeletion ? toBranchDeletionRow(task.branchDeletion) : null,
    kind: task.kind,
    ...dropReasonColumns(task.dropReason),
    causedByTaskId: task.causedBy ?? null,
    foundInVersion: task.foundInVersion ?? null,
    foundWhileWorkingOnTaskId: task.foundWhileWorkingOn ?? null,
    createdByTheOffice: task.createdByTheOffice,
    engineId: task.engineOverride,
  };
}

/** A Task's row as it is written: every column but `model`, which no release reads any more. */
export type WrittenTaskRow = Omit<TaskRow, "model">;
/** An Initiative's row as it is written: every column but `model`, which no release reads any more. */
export type WrittenInitiativeRow = Omit<InitiativeRow, "model">;

/**
 * The `model` an update leaves beside the engine override (spec 5.4.5): the one the row keeps
 * while the engine stays, else none, so the release before, which still reads it, never pairs a
 * model with another engine after a rollback.
 */
function modelKeptBeside(
  columns: { readonly engineId: Column; readonly model: Column },
  engineOverride: string | null,
): SQL {
  return sql`case when ${columns.engineId} is not distinct from ${engineOverride} then ${columns.model} end`;
}

/** The Task's row as an update writes it: its `model` kept only while its engine override stays. */
export function taskRowUpdate(task: Task): WrittenTaskRow & { readonly model: SQL } {
  return { ...toTaskRow(task), model: modelKeptBeside(tasks, task.engineOverride) };
}

/** The Initiative's row as an update writes it: its `model` kept only while its engine override stays. */
export function initiativeRowUpdate(
  initiative: Initiative,
): WrittenInitiativeRow & { readonly model: SQL } {
  return {
    ...toInitiativeRow(initiative),
    model: modelKeptBeside(initiatives, initiative.engineOverride),
  };
}

/** A drop reason as its three columns keep it: its kind, Other's words and Duplicate's Task. */
function dropReasonColumns(
  reason: DropReason | undefined,
): Pick<TaskRow, "dropReason" | "dropReasonText" | "duplicateOfTaskId"> {
  return {
    dropReason: reason?.kind ?? null,
    dropReasonText: reason?.kind === "other" ? reason.text : null,
    duplicateOfTaskId: reason?.kind === "duplicate" ? reason.taskId : null,
  };
}

/** The drop reason its three columns keep; undefined for none, or one whose parts are missing. */
function dropReasonOf(
  row: Pick<TaskRow, "dropReason" | "dropReasonText" | "duplicateOfTaskId">,
): DropReason | undefined {
  switch (row.dropReason) {
    case "wont-fix":
    case "cant-reproduce":
      return { kind: row.dropReason };
    case "duplicate":
      return row.duplicateOfTaskId
        ? { kind: "duplicate", taskId: row.duplicateOfTaskId }
        : undefined;
    case "other":
      return row.dropReasonText ? { kind: "other", text: row.dropReasonText } : undefined;
    default:
      return undefined;
  }
}

function toBranchDeletionRow(deletion: BranchDeletionRecord): BranchDeletionRow {
  return { ...deletion, at: deletion.at.toISOString() };
}

function branchDeletionOf(row: BranchDeletionRow): BranchDeletionRecord {
  return {
    ...row,
    at: new Date(row.at),
    by: row.by.kind === "office" ? row.by : authorOf(row.by),
  };
}

function toPullRequestEndRow(end: PullRequestEnd): PullRequestEndRow {
  return { ...end, at: end.at.toISOString(), method: end.method ?? null };
}

function pullRequestEndOf(row: PullRequestEndRow): PullRequestEnd {
  return {
    ...row,
    at: new Date(row.at),
    method: row.method ?? undefined,
    by: row.by.kind === "code-host" ? row.by : authorOf(row.by),
  };
}

export function toTask(row: TaskRow): Task {
  return {
    ...toTaskSummary(row),
    description: row.description,
    plan: row.plan,
    definitionOfDone: row.definitionOfDone,
    commitMessage: row.commitMessage,
    proposedPipeline: row.proposedPipeline ?? undefined,
  };
}

/** A row's columns without the Task's long texts, which `TASK_SUMMARY_COLUMNS` reads. */
export type TaskSummaryRow = Omit<TaskRow, TaskTextField>;

const {
  description: _description,
  plan: _plan,
  definitionOfDone: _definitionOfDone,
  commitMessage: _commitMessage,
  proposedPipeline: _proposedPipeline,
  ...taskSummaryColumns
} = getTableColumns(tasks);

/** The columns a read of Task summaries selects: every one but the long texts. */
export const TASK_SUMMARY_COLUMNS = taskSummaryColumns;

export function toTaskSummary(row: TaskSummaryRow): TaskSummary {
  return {
    id: row.id,
    title: row.title,
    projectId: row.projectId,
    state: row.state,
    priority: row.priority,
    tags: row.tags,
    order: row.order,
    planConfirmed: row.planConfirmed,
    filesToChange: row.filesToChange,
    estimatedTokens: row.estimatedTokens ?? undefined,
    definitionOfDoneConfirmed: row.definitionOfDoneConfirmed,
    commitMessagePublishedAt: row.commitMessagePublishedAt ?? undefined,
    pipelineId: row.pipelineId ?? undefined,
    autoMode: row.autoMode,
    initiativePlanningThreadId: row.initiativePlanningThreadId ?? undefined,
    markedPlanned: row.markedPlanned,
    hasPlanningThread: row.hasPlanningThread,
    personRole: row.personRole ?? undefined,
    engineStandIns: row.engineStandIns,
    pausedBy: row.pausedBy ?? undefined,
    resumesAt: row.resumesAt ?? undefined,
    usageWindowEngineId: row.usageWindowEngineId ?? undefined,
    usageWindowPausedAt: row.usageWindowPausedAt ?? undefined,
    madeFor: row.madeFor ?? undefined,
    resolvesTaskId: row.resolvesTaskId ?? undefined,
    blockedBy: row.blockedBy,
    originIdeaId: row.originIdeaId ?? undefined,
    initiativeId: row.initiativeId ?? undefined,
    projectMoves: row.projectMoves.map((move) => ({
      ...move,
      at: new Date(move.at),
      by: authorOf(move.by),
    })),
    createdBy: authorOf(row.createdBy),
    createdAt: row.createdAt,
    archivedAt: row.archivedAt ?? undefined,
    archivedBy: row.archivedBy ?? undefined,
    restoredAt: row.restoredAt ?? undefined,
    restoredBy: row.restoredBy ? authorOf(row.restoredBy) : undefined,
    endedAt: row.endedAt ?? undefined,
    pullRequestEnd: row.pullRequestEnd ? pullRequestEndOf(row.pullRequestEnd) : undefined,
    branchDeletion: row.branchDeletion ? branchDeletionOf(row.branchDeletion) : undefined,
    kind: row.kind,
    causedBy: row.causedByTaskId ?? undefined,
    foundInVersion: row.foundInVersion ?? undefined,
    foundWhileWorkingOn: row.foundWhileWorkingOnTaskId ?? undefined,
    dropReason: dropReasonOf(row),
    createdByTheOffice: row.createdByTheOffice,
    // The engine override alone: a row from the release before keeps its engine, its model unread.
    engineOverride: row.engineId,
  };
}

export function ownerColumns(
  owner: AttachmentOwner,
): Pick<AttachmentRow, "ideaId" | "initiativeId" | "taskId" | "threadId"> {
  return {
    ideaId: owner.kind === "idea" ? owner.ideaId : null,
    initiativeId: owner.kind === "initiative" ? owner.initiativeId : null,
    taskId: owner.kind === "task" ? owner.taskId : null,
    threadId: owner.kind === "thread" ? owner.threadId : null,
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
    ? { ...fields, url: attachment.url, mediaType: null, size: null, text: null, sourcePath: null }
    : {
        ...fields,
        url: null,
        mediaType: attachment.mediaType,
        size: attachment.size,
        text: attachment.text,
        sourcePath: attachment.sourcePath ?? null,
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
    addedBy: authorOf(row.addedBy),
    addedAt: row.addedAt,
  };
  if (row.kind === "link") return { ...fields, kind: row.kind, url: present(row.url) };
  return {
    ...fields,
    kind: row.kind,
    mediaType: present(row.mediaType),
    size: present(row.size),
    text: row.text ?? false,
    sourcePath: row.sourcePath ?? undefined,
  };
}

function ownerOf(row: AttachmentRow): AttachmentOwner {
  if (row.ideaId !== null) return { kind: "idea", ideaId: row.ideaId };
  if (row.initiativeId !== null) return { kind: "initiative", initiativeId: row.initiativeId };
  if (row.threadId !== null) return { kind: "thread", threadId: row.threadId };
  return { kind: "task", taskId: present(row.taskId) };
}

function present<Value>(value: Value | null): Value {
  if (value === null) throw new Error("An attachments row breaks the table's checks.");
  return value;
}
