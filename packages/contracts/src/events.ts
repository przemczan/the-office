import { z } from "zod";
import { API_PATH } from "./api.js";

/** Where the web opens its WebSocket to the service. */
export const EVENTS_PATH = `${API_PATH}/events`;

/**
 * The event types sent only to subscriptions scoped to the event's `threadId`, never to a
 * subscription without a scope: a Thread's output reaches only the pages showing that Thread.
 */
export const THREAD_SCOPED_EVENT_TYPES = [
  "thread.sub-agent-messages",
  "thread.process-output",
] as const;
export type ThreadScopedEventType = (typeof THREAD_SCOPED_EVENT_TYPES)[number];

export function isThreadScopedEventType(type: string): type is ThreadScopedEventType {
  return (THREAD_SCOPED_EVENT_TYPES as readonly string[]).includes(type);
}

const eventTypesSchema = z.array(z.string().min(1)).min(1);

/**
 * What the web sends: event types to start receiving, or to stop receiving. With a `threadId`, the
 * subscriptions are scoped to that Thread: they receive the events of their types whose `threadId`
 * is that one, and are the only ones a thread-scoped type is sent to. Without it, they receive
 * every event of their types but the thread-scoped ones. Unsubscribing with a scope removes only
 * that scope's subscriptions.
 */
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribe"),
    events: eventTypesSchema,
    threadId: z.uuid().optional(),
  }),
  z.object({
    type: z.literal("unsubscribe"),
    events: eventTypesSchema,
    threadId: z.uuid().optional(),
  }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/**
 * The fields every event the web receives has. Each module's events extend it with a literal
 * `type` and their own fields, and join the union the web parses server messages with.
 */
export const webEventSchema = z.object({
  type: z.string().min(1),
  occurredAt: z.iso.datetime(),
});
export type WebEvent = z.infer<typeof webEventSchema>;

/**
 * What the service sends, for a given union of events: an event; the event types the client now
 * receives, after each subscribe or unsubscribe (those without a scope, or with the `threadId` of
 * the message's scope, those scoped to it); or why a client message was refused.
 */
export function serverMessageSchema<Event extends z.ZodType<WebEvent>>(eventSchema: Event) {
  return z.discriminatedUnion("type", [
    z.object({ type: z.literal("event"), event: eventSchema }),
    z.object({
      type: z.literal("subscriptions"),
      events: z.array(z.string()),
      threadId: z.uuid().optional(),
    }),
    z.object({ type: z.literal("refused"), reason: z.string() }),
  ]);
}
export type ServerMessage<Event extends WebEvent = WebEvent> = z.infer<
  ReturnType<typeof serverMessageSchema<z.ZodType<Event>>>
>;
