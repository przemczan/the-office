import { z } from "zod";

/** Where the web opens its WebSocket to the service. */
export const EVENTS_PATH = "/api/events";

const eventTypesSchema = z.array(z.string().min(1)).min(1);

/** What the web sends: event types to start receiving, or to stop receiving. */
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribe"), events: eventTypesSchema }),
  z.object({ type: z.literal("unsubscribe"), events: eventTypesSchema }),
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
 * receives, after each subscribe or unsubscribe; or why a client message was refused.
 */
export function serverMessageSchema<Event extends z.ZodType<WebEvent>>(eventSchema: Event) {
  return z.discriminatedUnion("type", [
    z.object({ type: z.literal("event"), event: eventSchema }),
    z.object({ type: z.literal("subscriptions"), events: z.array(z.string()) }),
    z.object({ type: z.literal("refused"), reason: z.string() }),
  ]);
}
export type ServerMessage<Event extends WebEvent = WebEvent> = z.infer<
  ReturnType<typeof serverMessageSchema<z.ZodType<Event>>>
>;
