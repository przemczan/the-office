import { z } from "zod";
import { webEventSchema } from "./events.js";

/** Who captured, created or attached something: the user, or a person by their Role's key. */
export const authorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({ kind: z.literal("person"), roleKey: z.string() }),
]);
export type Author = z.infer<typeof authorSchema>;

export const ideaStateSchema = z.enum(["new", "shaped", "dropped"]);
export type IdeaState = z.infer<typeof ideaStateSchema>;

/** What the user gives to capture an Idea (POST /ideas); a null Project is Office-wide. */
export const newIdeaSchema = z.object({
  title: z.string(),
  notes: z.string(),
  projectId: z.string().nullable(),
});
export type NewIdea = z.infer<typeof newIdeaSchema>;

export const ideaSchema = newIdeaSchema.extend({
  id: z.uuid(),
  state: ideaStateSchema,
  /** The Task it was shaped into. */
  taskId: z.uuid().nullable(),
  capturedBy: authorSchema,
  capturedAt: z.iso.datetime(),
  droppedAt: z.iso.datetime().nullable(),
});
export type Idea = z.infer<typeof ideaSchema>;

export const ideaListSchema = z.array(ideaSchema);

/** POST /ideas/:id/shape: the Project the Task is made in. */
export const ideaShapingSchema = z.object({ projectId: z.string() });
export type IdeaShaping = z.infer<typeof ideaShapingSchema>;

export const taskStateSchema = z.enum([
  "backlog",
  "planning",
  "ready",
  "in-progress",
  "waiting-on-you",
  "paused",
  "done",
  "dropped",
]);
export type TaskState = z.infer<typeof taskStateSchema>;

/** Highest first. */
export const prioritySchema = z.enum(["high", "normal", "low"]);
export type Priority = z.infer<typeof prioritySchema>;

/** What creating a Task takes (POST /tasks); it starts in Backlog. */
export const newTaskSchema = z.object({
  title: z.string(),
  projectId: z.string(),
  priority: prioritySchema,
});
export type NewTask = z.infer<typeof newTaskSchema>;

/** A Pipeline the Planner proposes for a Task, with why it fits the Definition of Done. */
export const proposedPipelineSchema = z.object({ pipelineId: z.string(), reason: z.string() });
export type ProposedPipeline = z.infer<typeof proposedPipelineSchema>;

export const taskSchema = newTaskSchema.extend({
  id: z.uuid(),
  state: taskStateSchema,
  plan: z.string(),
  /** False while the Plan is the Planner's proposal; true once the user confirmed or edited it. */
  planConfirmed: z.boolean(),
  definitionOfDone: z.array(z.string()),
  /** As `planConfirmed`, for the Definition of Done. */
  definitionOfDoneConfirmed: z.boolean(),
  /** The Pipeline its work follows. */
  pipelineId: z.string(),
  /** The Pipeline the Planner proposes, until the user confirms it or chooses another. */
  proposedPipeline: proposedPipelineSchema.nullable(),
  originIdeaId: z.uuid().nullable(),
  createdBy: authorSchema,
  createdAt: z.iso.datetime(),
});
export type Task = z.infer<typeof taskSchema>;

/** Every Task, in the board's order: by priority, then by manual order. */
export const taskListSchema = z.array(taskSchema);

/** PUT /tasks/:id/priority */
export const priorityChangeSchema = z.object({ priority: prioritySchema });
export type PriorityChange = z.infer<typeof priorityChangeSchema>;

/**
 * PUT /tasks/:id/plan: the user's Plan, confirmed. Confirming the proposed one sends it as shown,
 * so what is confirmed is what the user read; an edit sends the edited words.
 */
export const planChangeSchema = z.object({ plan: z.string() });
export type PlanChange = z.infer<typeof planChangeSchema>;

/** PUT /tasks/:id/definition-of-done: the user's Definition of Done, confirmed, as with the Plan. */
export const definitionOfDoneChangeSchema = z.object({ definitionOfDone: z.array(z.string()) });
export type DefinitionOfDoneChange = z.infer<typeof definitionOfDoneChangeSchema>;

/**
 * PUT /tasks/:id/pipeline: the Pipeline the user sets for the Task, by id: the proposed one to
 * confirm it, or another from the library. Either ends the proposal.
 */
export const pipelineChangeSchema = z.object({ pipelineId: z.string() });
export type PipelineChange = z.infer<typeof pipelineChangeSchema>;

/**
 * PUT /tasks/:id/place: the Tasks it lands between in its column of the board, null at either
 * end. It takes the priority that keeps it there.
 */
export const taskPlacementSchema = z.object({
  above: z.uuid().nullable(),
  below: z.uuid().nullable(),
});
export type TaskPlacement = z.infer<typeof taskPlacementSchema>;

/** GET /tasks/:id/start: why POST /tasks/:id/start would be refused now; empty when it can start. */
export const startCheckSchema = z.object({ reasons: z.array(z.string()) });
export type StartCheck = z.infer<typeof startCheckSchema>;

export const attachmentOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("idea"), ideaId: z.uuid() }),
  z.object({ kind: z.literal("task"), taskId: z.uuid() }),
]);
export type AttachmentOwner = z.infer<typeof attachmentOwnerSchema>;

/** POST /ideas/:id/attachments/links and /tasks/:id/attachments/links; an empty name is the URL. */
export const newLinkSchema = z.object({ name: z.string(), url: z.string() });
export type NewLink = z.infer<typeof newLinkSchema>;

/**
 * The query of POST /ideas/:id/attachments/files and /tasks/:id/attachments/files, whose body is
 * the file itself as `application/octet-stream`.
 */
export const attachmentUploadQuerySchema = z.object({
  fileName: z.string().min(1),
  mediaType: z.string(),
});
export type AttachmentUploadQuery = z.infer<typeof attachmentUploadQuerySchema>;

const attachmentFields = {
  id: z.uuid(),
  owner: attachmentOwnerSchema,
  name: z.string(),
  addedBy: authorSchema,
  addedAt: z.iso.datetime(),
};

/** A link opens at its URL; a file at GET /attachments/:id/content. */
export const attachmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link"), ...attachmentFields, url: z.string() }),
  z.object({
    /** A document is Markdown; an image is shown as a picture. */
    kind: z.enum(["document", "image", "file"]),
    ...attachmentFields,
    mediaType: z.string(),
    /** In bytes. */
    size: z.int().nonnegative(),
  }),
]);
export type Attachment = z.infer<typeof attachmentSchema>;

export const attachmentListSchema = z.array(attachmentSchema);

/** What a refused change answers: every reason, also joined into Nest's `message`. */
export const workRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type WorkRefusal = z.infer<typeof workRefusalSchema>;

/** Work's events the web receives; each names what changed, so its queries refresh. */
export const workWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("idea.captured"), ideaId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("idea.shaped"), ideaId: z.uuid(), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("idea.dropped"), ideaId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("idea.restored"), ideaId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.created"), taskId: z.uuid() }),
  webEventSchema.extend({
    type: z.literal("task.state-changed"),
    taskId: z.uuid(),
    from: taskStateSchema,
    to: taskStateSchema,
  }),
  webEventSchema.extend({ type: z.literal("task.started"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.paused"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.stopped"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.resumed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.priority-changed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.reordered"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.plan-proposed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.plan-confirmed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.definition-of-done-proposed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.definition-of-done-confirmed"), taskId: z.uuid() }),
  webEventSchema.extend({
    type: z.literal("task.pipeline-proposed"),
    taskId: z.uuid(),
    pipelineId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("task.pipeline-confirmed"),
    taskId: z.uuid(),
    pipelineId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("attachment.added"),
    attachmentId: z.uuid(),
    owner: attachmentOwnerSchema,
  }),
  webEventSchema.extend({
    type: z.literal("attachment.moved"),
    attachmentId: z.uuid(),
    from: attachmentOwnerSchema,
    to: attachmentOwnerSchema,
  }),
  webEventSchema.extend({
    type: z.literal("attachment.removed"),
    attachmentId: z.uuid(),
    owner: attachmentOwnerSchema,
  }),
]);
export type WorkWebEvent = z.infer<typeof workWebEventSchema>;
