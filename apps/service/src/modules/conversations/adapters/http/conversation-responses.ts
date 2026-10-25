import type {
  DecisionAnswer as DecisionAnswerResponse,
  Decision as DecisionResponse,
  Message as MessageResponse,
  Thread as ThreadResponse,
} from "@the-office/contracts";
import type { ContextDecision } from "../../domain/context-policy.js";
import type { Decision, GivenAnswer } from "../../domain/decision.js";
import type { Message } from "../../domain/message.js";
import type { Thread } from "../../domain/thread.js";

export function toThreadResponse(thread: Thread, context: ContextDecision): ThreadResponse {
  return {
    id: thread.id,
    home: thread.home,
    roleKey: thread.roleKey,
    title: thread.title ?? null,
    state: thread.state,
    tokens: { ...thread.tokens },
    context: {
      move: context.move,
      reason: context.reason,
      cacheWarm: context.cacheWarm,
      contextTokens: context.contextTokens,
      briefTokens: context.briefTokens ?? null,
      alternatives: context.alternatives.map(({ override, tokens }) => ({ override, tokens })),
      override: thread.override ?? null,
    },
    startedAt: thread.startedAt.toISOString(),
  };
}

/** A message of the log; a Decision's card and answer show the Decision as it is now. */
export function toMessageResponse(
  { threadId: _threadId, at, ...message }: Message,
  decisions: ReadonlyMap<string, Decision>,
): MessageResponse {
  const fields = { ...message, at: at.toISOString() };
  switch (fields.kind) {
    case "context":
      return { ...fields, briefTokens: fields.briefTokens ?? null };
    case "decision":
    case "decision-answer": {
      const { decisionId, ...card } = fields;
      const decision = decisions.get(decisionId);
      if (!decision) {
        throw new Error(`Message ${message.id} shows the Decision ${decisionId}, which is gone.`);
      }
      return { ...card, decision: toDecisionResponse(decision) };
    }
    default:
      return fields;
  }
}

export function toDecisionResponse({ answer, askedAt, ...decision }: Decision): DecisionResponse {
  return {
    ...decision,
    options: [...decision.options],
    recommendation: { ...decision.recommendation },
    askedAt: askedAt.toISOString(),
    answer: answer ? toAnswerResponse(answer) : null,
    answeredAt: answer?.answeredAt.toISOString() ?? null,
  };
}

function toAnswerResponse(answer: GivenAnswer): DecisionAnswerResponse {
  return answer.kind === "option"
    ? { kind: "option", option: answer.option }
    : { kind: "free-answer", text: answer.text };
}
