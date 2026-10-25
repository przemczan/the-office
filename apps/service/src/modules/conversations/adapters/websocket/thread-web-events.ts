import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { ThreadWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { MessagesLogged, ThreadRenamed, ThreadStarted } from "../../domain/conversation-events.js";
import type { Thread } from "../../domain/thread.js";

type WebEventOf<Type extends ThreadWebEvent["type"]> = Omit<
  Extract<ThreadWebEvent, { type: Type }>,
  "occurredAt"
>;

/** Every Conversations event reaches the web, naming the Thread and its home, so open pages refetch. */
@Injectable()
export class ThreadWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(ThreadStarted, (event): WebEventOf<"thread.started"> => ({
      type: "thread.started",
      ...namesOf(event.thread),
    }));
    this.forwarding.forward(ThreadRenamed, (event): WebEventOf<"thread.renamed"> => ({
      type: "thread.renamed",
      ...namesOf(event.thread),
    }));
    this.forwarding.forward(MessagesLogged, (event): WebEventOf<"thread.messages-logged"> => ({
      type: "thread.messages-logged",
      ...namesOf(event.thread),
    }));
  }
}

function namesOf(thread: Thread): Pick<ThreadWebEvent, "threadId" | "home"> {
  return { threadId: thread.id, home: thread.home };
}
