import type {
  DecisionAnswer as DecisionAnswerResponse,
  Decision as DecisionResponse,
  Message as MessageResponse,
  Thread as ThreadResponse,
} from "@the-office/contracts";
import type { ContextDecision } from "../../domain/context-policy.js";
import type { Decision, DecisionAnswer } from "../../domain/decision.js";
import type { Message } from "../../domain/message.js";
import { tokensSoFar, type Thread } from "../../domain/thread.js";

export function toThreadResponse(thread: Thread, context: ContextDecision): ThreadResponse {
  return {
    id: thread.id,
    home: thread.home,
    roleKey: thread.roleKey,
    title: thread.title ?? null,
    state: thread.state,
    tokens: tokensSoFar(thread),
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
    stageThread: thread.stageThread,
  };
}

/**
 * A message of the log; a Decision's card and answer show the Decision as it is now, and the
 * answer's line also the answer it gave, which a Decision opened again no longer holds.
 */
export function toMessageResponse(
  { threadId: _threadId, at, ...message }: Message,
  decisions: ReadonlyMap<string, Decision>,
): MessageResponse {
  const fields = { ...message, at: at.toISOString() };
  switch (fields.kind) {
    case "context":
      return { ...fields, briefTokens: fields.briefTokens ?? null, brief: fields.brief ?? null };
    case "decision": {
      const { decisionId, roleKey, ...card } = fields;
      return {
        ...card,
        roleKey: roleKey ?? null,
        decision: toDecisionResponse(decisionOf(message.id, decisionId, decisions)),
      };
    }
    case "decision-answer": {
      const { decisionId, answer, ...line } = fields;
      return {
        ...line,
        answer: toAnswerResponse(answer),
        decision: toDecisionResponse(decisionOf(message.id, decisionId, decisions)),
      };
    }
    default:
      return fields;
  }
}

function decisionOf(
  messageId: string,
  decisionId: string,
  decisions: ReadonlyMap<string, Decision>,
): Decision {
  const decision = decisions.get(decisionId);
  if (!decision) {
    throw new Error(`Message ${messageId} shows the Decision ${decisionId}, which is gone.`);
  }
  return decision;
}

export function toDecisionResponse({ answer, askedAt, ...decision }: Decision): DecisionResponse {
  return {
    ...decision,
    roleKey: decision.roleKey ?? null,
    options: [...decision.options],
    recommendation: { ...decision.recommendation },
    askedAt: askedAt.toISOString(),
    answer: answer ? toAnswerResponse(answer) : null,
    answeredAt: answer?.answeredAt.toISOString() ?? null,
  };
}

function toAnswerResponse(answer: DecisionAnswer): DecisionAnswerResponse {
  return answer.kind === "option"
    ? { kind: "option", option: answer.option }
    : { kind: "free-answer", text: answer.text };
}
