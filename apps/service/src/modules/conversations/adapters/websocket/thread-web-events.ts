import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { ThreadWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  ContextOverrideChosen,
  DecisionAnswered,
  DecisionOpened,
  MessagesLogged,
  ThreadRenamed,
  ThreadStarted,
  TurnEnded,
} from "../../domain/conversation-events.js";
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
    this.forwarding.forward(TurnEnded, (event): WebEventOf<"thread.turn-ended"> => ({
      type: "thread.turn-ended",
      ...namesOf(event.thread),
    }));
    this.forwarding.forward(
      ContextOverrideChosen,
      (event): WebEventOf<"thread.override-chosen"> => ({
        type: "thread.override-chosen",
        ...namesOf(event.thread),
      }),
    );
    this.forwarding.forward(DecisionOpened, (event): WebEventOf<"thread.decision-opened"> => ({
      type: "thread.decision-opened",
      ...namesOf(event.thread),
      decisionId: event.decision.id,
    }));
    this.forwarding.forward(DecisionAnswered, (event): WebEventOf<"thread.decision-answered"> => ({
      type: "thread.decision-answered",
      ...namesOf(event.thread),
      decisionId: event.decision.id,
    }));
  }
}

function namesOf(thread: Thread): Pick<ThreadWebEvent, "threadId" | "home"> {
  return { threadId: thread.id, home: thread.home };
}
