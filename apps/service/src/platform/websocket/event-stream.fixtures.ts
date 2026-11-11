import { serverMessageSchema, webEventSchema } from "@the-office/contracts";
import { z } from "zod";
import { DomainEvent } from "../events/domain-event.js";
import type { WebEventForwarding } from "./web-event-forwarding.js";

// The test brings its own events, through the same path a module uses.
export class LampLit extends DomainEvent {
  constructor(readonly room: string) {
    super(new Date("2026-10-25T09:00:00.000Z"));
  }
}

export class LampDimmed extends DomainEvent {}

/** Events naming a Thread: two of the thread-scoped types and one sent as any other. */
class ThreadEvent extends DomainEvent {
  constructor(readonly threadId: string) {
    super(new Date("2026-10-25T09:00:00.000Z"));
  }
}

export class OutputPrinted extends ThreadEvent {}

export class SubAgentWrote extends ThreadEvent {}

export class ThreadLampLit extends ThreadEvent {}

export const THREAD_A = "0b6a2f4e-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
export const THREAD_B = "7e8f9a0b-1c2d-4e3f-9a4b-5c6d7e8f9a0b";

export const lampLitSchema = webEventSchema.extend({
  type: z.literal("lamp.lit"),
  room: z.string(),
});

export const lampDimmedSchema = webEventSchema.extend({ type: z.literal("lamp.dimmed") });

const threadEventSchema = webEventSchema.extend({
  type: z.enum(["thread.process-output", "thread.sub-agent-messages", "thread.lamp-lit"]),
  threadId: z.uuid(),
});

export const messageSchema = serverMessageSchema(
  z.union([z.discriminatedUnion("type", [lampLitSchema, lampDimmedSchema]), threadEventSchema]),
);

export type Message = z.infer<typeof messageSchema>;

/** Forwards the Thread events above, as their modules would. */
export function forwardThreadEvents(forwarding: WebEventForwarding): void {
  forwarding.forward(OutputPrinted, (event) => ({
    type: "thread.process-output",
    threadId: event.threadId,
  }));
  forwarding.forward(SubAgentWrote, (event) => ({
    type: "thread.sub-agent-messages",
    threadId: event.threadId,
  }));
  forwarding.forward(ThreadLampLit, (event) => ({
    type: "thread.lamp-lit",
    threadId: event.threadId,
  }));
}

export async function changeSubscription(
  client: WebSocket,
  next: () => Promise<Message>,
  type: "subscribe" | "unsubscribe",
  events: string[],
  threadId?: string,
): Promise<Message> {
  client.send(JSON.stringify({ type, events, threadId }));
  return next();
}
