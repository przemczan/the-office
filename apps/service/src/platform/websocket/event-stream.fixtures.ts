import { serverMessageSchema, webEventSchema } from "@the-office/contracts";
import { z } from "zod";
import { DomainEvent } from "../events/domain-event.js";

// The test brings its own events, through the same path a module uses.
export class LampLit extends DomainEvent {
  constructor(readonly room: string) {
    super(new Date("2026-10-25T09:00:00.000Z"));
  }
}

export class LampDimmed extends DomainEvent {}

export const lampLitSchema = webEventSchema.extend({
  type: z.literal("lamp.lit"),
  room: z.string(),
});

export const lampDimmedSchema = webEventSchema.extend({ type: z.literal("lamp.dimmed") });

export const messageSchema = serverMessageSchema(
  z.discriminatedUnion("type", [lampLitSchema, lampDimmedSchema]),
);

export type Message = z.infer<typeof messageSchema>;

export async function changeSubscription(
  client: WebSocket,
  next: () => Promise<Message>,
  type: "subscribe" | "unsubscribe",
  events: string[],
): Promise<Message> {
  client.send(JSON.stringify({ type, events }));
  return next();
}
