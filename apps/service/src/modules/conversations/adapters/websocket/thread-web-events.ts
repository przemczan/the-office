import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { ThreadWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  ContextOverrideChosen,
  DecisionAnswered,
  DecisionOpened,
  DeliveryMarked,
  DecisionReopened,
  MessagesLogged,
  OfficeInstructionsChanged,
  ProposalApplied,
  ProposalDeclined,
  ProposalDrafted,
  SizeThresholdChanged,
  ThreadRenamed,
  ThreadStarted,
  TokensCounted,
  TurnEnded,
} from "../../domain/conversation-events.js";
import { tokensSoFar, type Thread } from "../../domain/thread.js";

type WebEventOf<Type extends ThreadWebEvent["type"]> = Omit<
  Extract<ThreadWebEvent, { type: Type }>,
  "occurredAt"
>;

/**
 * Every Conversations event reaches the web, naming the Thread and its home, so open pages refetch;
 * a count of tokens carries them, for the pages to show without refetching. A new size threshold
 * names no Thread: every label may change. Nor do new Office instructions, which only Settings and
 * a Proposal's card show.
 */
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
    this.forwarding.forward(DeliveryMarked, (event): WebEventOf<"thread.delivery-marked"> => ({
      type: "thread.delivery-marked",
      ...namesOf(event.thread),
    }));
    this.forwarding.forward(TurnEnded, (event): WebEventOf<"thread.turn-ended"> => ({
      type: "thread.turn-ended",
      ...namesOf(event.thread),
    }));
    this.forwarding.forward(TokensCounted, (event): WebEventOf<"thread.tokens-counted"> => ({
      type: "thread.tokens-counted",
      ...namesOf(event.thread),
      tokens: tokensSoFar(event.thread),
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
    this.forwarding.forward(DecisionReopened, (event): WebEventOf<"thread.decision-reopened"> => ({
      type: "thread.decision-reopened",
      ...namesOf(event.thread),
      decisionId: event.decision.id,
    }));
    this.forwarding.forward(ProposalDrafted, (event): WebEventOf<"thread.proposal-drafted"> => ({
      type: "thread.proposal-drafted",
      ...namesOf(event.thread),
      proposalId: event.proposal.id,
    }));
    this.forwarding.forward(ProposalApplied, (event): WebEventOf<"thread.proposal-applied"> => ({
      type: "thread.proposal-applied",
      ...namesOf(event.thread),
      proposalId: event.proposal.id,
    }));
    this.forwarding.forward(ProposalDeclined, (event): WebEventOf<"thread.proposal-declined"> => ({
      type: "thread.proposal-declined",
      ...namesOf(event.thread),
      proposalId: event.proposal.id,
    }));
    this.forwarding.forward(
      SizeThresholdChanged,
      (): WebEventOf<"context-policy.size-threshold-changed"> => ({
        type: "context-policy.size-threshold-changed",
      }),
    );
    this.forwarding.forward(
      OfficeInstructionsChanged,
      (): WebEventOf<"office-instructions.changed"> => ({ type: "office-instructions.changed" }),
    );
  }
}

function namesOf(thread: Thread): Pick<WebEventOf<"thread.started">, "threadId" | "home"> {
  return { threadId: thread.id, home: thread.home };
}
