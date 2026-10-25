import { sql } from "drizzle-orm";
import type { Database } from "../../../../platform/database/database.js";
import type { Attachment, AttachmentOwner } from "../../domain/attachment.js";
import type { Idea } from "../../domain/idea.js";
import type { Task } from "../../domain/task.js";
import { attachments, ideas, tasks } from "./work.schema.js";

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type IdeaRow = typeof ideas.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;

/**
 * Holds the board's manual order until the transaction ends, so whatever writes an order key reads
 * the keys taken and saves its own before anyone else reads them.
 */
export async function holdManualOrder(transaction: Transaction): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('work.manual-order'))`);
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
    capturedBy: row.capturedBy,
    capturedAt: row.capturedAt,
    droppedAt: row.droppedAt ?? undefined,
  };
}

export function toTaskRow(task: Task): TaskRow {
  return {
    id: task.id,
    title: task.title,
    projectId: task.projectId,
    state: task.state,
    priority: task.priority,
    order: task.order,
    plan: task.plan,
    planConfirmed: task.planConfirmed,
    definitionOfDone: [...task.definitionOfDone],
    definitionOfDoneConfirmed: task.definitionOfDoneConfirmed,
    pipelineId: task.pipelineId,
    proposedPipeline: task.proposedPipeline ?? null,
    originIdeaId: task.originIdeaId ?? null,
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
    order: row.order,
    plan: row.plan,
    planConfirmed: row.planConfirmed,
    definitionOfDone: row.definitionOfDone,
    definitionOfDoneConfirmed: row.definitionOfDoneConfirmed,
    pipelineId: row.pipelineId,
    proposedPipeline: row.proposedPipeline ?? undefined,
    originIdeaId: row.originIdeaId ?? undefined,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export function ownerColumns(owner: AttachmentOwner): Pick<AttachmentRow, "ideaId" | "taskId"> {
  return owner.kind === "idea"
    ? { ideaId: owner.ideaId, taskId: null }
    : { ideaId: null, taskId: owner.taskId };
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
  return { kind: "task", taskId: present(row.taskId) };
}

function present<Value>(value: Value | null): Value {
  if (value === null) throw new Error("An attachments row breaks the table's checks.");
  return value;
}
