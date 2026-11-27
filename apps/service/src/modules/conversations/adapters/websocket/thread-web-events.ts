import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { ThreadWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  ContextOverrideChosen,
  ContextRead,
  DecisionAnswered,
  DecisionClosed,
  DecisionOpened,
  DeliveryMarked,
  DecisionReopened,
  MessagesLogged,
  OfficeInstructionsChanged,
  ProcessOutputKept,
  ProposalApplied,
  ProposalDeclined,
  ProposalDrafted,
  SizeThresholdChanged,
  SubAgentMessagesKept,
  SubAgentOrProcessChanged,
  ThreadDeleted,
  ThreadRenamed,
  ThreadSeen,
  ThreadSessionMovedToEngine,
  ThreadStarted,
  TokensCounted,
  TurnEnded,
} from "../../domain/conversation-events.js";
import type { SessionWhere } from "../../domain/sub-agents-and-processes.js";
import { tokensSoFar, type Thread } from "../../domain/thread.js";
import {
  toOutputChunkResponse,
  toProcessResponse,
  toSubAgentMessageResponse,
  toSubAgentResponse,
} from "../http/sub-agent-and-process-responses.js";

type WebEventOf<Type extends ThreadWebEvent["type"]> = Omit<
  Extract<ThreadWebEvent, { type: Type }>,
  "occurredAt"
>;

/**
 * Every Conversations event reaches the web, naming the Thread and its home, so the open pages
 * showing that Thread or its home's list refetch;
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
    this.forwarding.forward(ThreadDeleted, (event): WebEventOf<"thread.deleted"> => ({
      type: "thread.deleted",
      ...namesOf(event.thread),
    }));
    this.forwarding.forward(ThreadSeen, (event): WebEventOf<"thread.seen"> => ({
      type: "thread.seen",
      ...namesOf(event.thread),
    }));
    this.forwarding.forward(MessagesLogged, (event): WebEventOf<"thread.messages-logged"> => ({
      type: "thread.messages-logged",
      ...namesOf(event.thread),
    }));
    // The web reads the Thread again, its `engine-switched` line and session's engine with it.
    this.forwarding.forward(
      ThreadSessionMovedToEngine,
      (event): WebEventOf<"thread.messages-logged"> => ({
        type: "thread.messages-logged",
        ...namesOf(event.thread),
      }),
    );
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
    this.forwarding.forward(ContextRead, (event): WebEventOf<"thread.context-read"> => ({
      type: "thread.context-read",
      ...namesOf(event.thread),
      contextTokens: event.thread.session?.contextTokens ?? 0,
      contextWindow: event.thread.session?.contextWindow ?? null,
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
    this.forwarding.forward(DecisionClosed, (event): WebEventOf<"thread.decision-closed"> => ({
      type: "thread.decision-closed",
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
    this.forwarding.forward(SubAgentOrProcessChanged, subAgentOrProcessWebEvent);
    this.forwarding.forward(
      SubAgentMessagesKept,
      (event): WebEventOf<"thread.sub-agent-messages"> => ({
        type: "thread.sub-agent-messages",
        ...namesOfSession(event.where),
        callId: event.callId,
        messages: event.messages.map(toSubAgentMessageResponse),
      }),
    );
    this.forwarding.forward(ProcessOutputKept, (event): WebEventOf<"thread.process-output"> => ({
      type: "thread.process-output",
      ...namesOfSession(event.where),
      callId: event.callId,
      chunk: toOutputChunkResponse(event.chunk),
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

function namesOfSession({
  threadId,
  home,
}: SessionWhere): Pick<WebEventOf<"thread.started">, "threadId" | "home"> {
  return { threadId, home };
}

/** A Process never changes between its start and its end: only a Sub-agent learns more. */
function subAgentOrProcessWebEvent({
  where,
  item,
  change,
}: SubAgentOrProcessChanged): WebEventOf<
  | "thread.sub-agent-started"
  | "thread.sub-agent-changed"
  | "thread.sub-agent-ended"
  | "thread.process-started"
  | "thread.process-ended"
> {
  const names = namesOfSession(where);
  if (item.kind === "sub-agent") {
    return { type: `thread.sub-agent-${change}`, ...names, item: toSubAgentResponse(item) };
  }
  return {
    type: change === "started" ? "thread.process-started" : "thread.process-ended",
    ...names,
    item: toProcessResponse(item),
  };
}
