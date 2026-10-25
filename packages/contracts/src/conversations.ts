import { z } from "zod";
import { webEventSchema } from "./events.js";

/** Where a conversation lives: a person's chat, by the Role's key, or a Task's. */
export const homeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat"), roleKey: z.string() }),
  z.object({ kind: z.literal("task"), taskId: z.string() }),
]);
export type Home = z.infer<typeof homeSchema>;

/** Whether the person is answering, or the Thread waits for the user's next message. */
export const threadStateSchema = z.enum(["waiting", "answering"]);
export type ThreadState = z.infer<typeof threadStateSchema>;

/** A Thread's tokens over all its turns, split as the engine reports them. */
export const tokenTotalsSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheCreation: z.number().int().nonnegative(),
});
export type TokenTotals = z.infer<typeof tokenTotalsSchema>;

/** The Context policy's moves (spec §2.5). */
export const contextMoveSchema = z.enum(["resume", "fresh", "hand-off"]);
export type ContextMove = z.infer<typeof contextMoveSchema>;

/** Why the policy chose the move, which the Thread's label shows. */
export const contextReasonSchema = z.enum([
  "new-thread",
  "another-person",
  "cache-warm",
  "small-context",
  "cache-expired",
  "session-default",
  "your-choice",
  "context-full",
]);
export type ContextReason = z.infer<typeof contextReasonSchema>;

/** "Start fresh" or "Continue anyway", for the next message only. */
export const contextOverrideSchema = z.enum(["start-fresh", "continue-anyway"]);
export type ContextOverride = z.infer<typeof contextOverrideSchema>;

/** What the Thread's next message does to its session, decided as the Thread is read. */
export const threadContextSchema = z.object({
  move: contextMoveSchema,
  reason: contextReasonSchema,
  cacheWarm: z.boolean(),
  contextTokens: z.number().int().nonnegative(),
  /** The Brief's estimate when the move starts a session with one. */
  briefTokens: z.number().int().nonnegative().nullable(),
  /** What the user may choose instead, with its estimated tokens. */
  alternatives: z.array(
    z.object({ override: contextOverrideSchema, tokens: z.number().int().nonnegative() }),
  ),
  /** What the user chose for the next message, or null for the policy's choice. */
  override: contextOverrideSchema.nullable(),
});
export type ThreadContext = z.infer<typeof threadContextSchema>;

/** GET /threads/:id, and each of a home's Threads. */
export const threadSchema = z.object({
  id: z.uuid(),
  home: homeSchema,
  /** The person the user talks to in it, by the key of the Role they fill. */
  roleKey: z.string(),
  /** From its first message until the user renames it; null before any message. */
  title: z.string().nullable(),
  state: threadStateSchema,
  tokens: tokenTotalsSchema,
  context: threadContextSchema,
  startedAt: z.iso.datetime(),
});
export type Thread = z.infer<typeof threadSchema>;

/** GET /chats/:roleKey/threads: the newest started first. */
export const threadListSchema = z.array(threadSchema);

/** POST /threads/:id/messages: the user's message, which the person answers. */
export const newMessageSchema = z.object({ text: z.string() });
export type NewMessage = z.infer<typeof newMessageSchema>;

/** PUT /threads/:id/context-override: null goes back to the policy's choice. */
export const contextOverrideChoiceSchema = z.object({ override: contextOverrideSchema.nullable() });
export type ContextOverrideChoice = z.infer<typeof contextOverrideChoiceSchema>;

/** PUT /threads/:id/title */
export const threadTitleSchema = z.object({ title: z.string() });
export type ThreadTitle = z.infer<typeof threadTitleSchema>;

const messageFields = { id: z.uuid(), at: z.iso.datetime() };

/** A message of The Office's log of a Thread, which is what the UI shows. */
export const messageSchema = z.discriminatedUnion("kind", [
  z.object({ ...messageFields, kind: z.literal("user"), text: z.string() }),
  z.object({ ...messageFields, kind: z.literal("person"), roleKey: z.string(), text: z.string() }),
  /** A few lines the person wrote for whoever continues, when The Office asked for them. */
  z.object({
    ...messageFields,
    kind: z.literal("handover-note"),
    roleKey: z.string(),
    text: z.string(),
  }),
  /** Something the person did with a tool, such as reading a file. */
  z.object({
    ...messageFields,
    kind: z.literal("tool-activity"),
    roleKey: z.string(),
    tool: z.string(),
    summary: z.string(),
  }),
  /** The move the Context policy made as the person took a message: The Office's line. */
  z.object({
    ...messageFields,
    kind: z.literal("context"),
    move: contextMoveSchema,
    reason: contextReasonSchema,
    contextTokens: z.number().int().nonnegative(),
    briefTokens: z.number().int().nonnegative().nullable(),
  }),
  /** Why the person couldn't answer. */
  z.object({ ...messageFields, kind: z.literal("failure"), reason: z.string() }),
  /** A tool call that was refused, with the reason the person read. */
  z.object({
    ...messageFields,
    kind: z.literal("refusal"),
    roleKey: z.string(),
    tool: z.string(),
    reason: z.string(),
  }),
]);
export type Message = z.infer<typeof messageSchema>;

/** GET /threads/:id/messages: in the order they were logged. */
export const messageListSchema = z.array(messageSchema);

/** What a refused Thread change answers: every reason, also joined into Nest's `message`. */
export const threadRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type ThreadRefusal = z.infer<typeof threadRefusalSchema>;

const threadWebEventFields = { threadId: z.uuid(), home: homeSchema };

/** The Conversations events the web receives; each names the Thread and its home. */
export const threadWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("thread.started"), ...threadWebEventFields }),
  webEventSchema.extend({ type: z.literal("thread.renamed"), ...threadWebEventFields }),
  webEventSchema.extend({ type: z.literal("thread.messages-logged"), ...threadWebEventFields }),
  webEventSchema.extend({ type: z.literal("thread.turn-ended"), ...threadWebEventFields }),
  webEventSchema.extend({ type: z.literal("thread.override-chosen"), ...threadWebEventFields }),
]);
export type ThreadWebEvent = z.infer<typeof threadWebEventSchema>;
