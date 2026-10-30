import type {
  ContextMove,
  ContextOverride,
  ContextReason,
  ThreadContext,
} from "@the-office/contracts";

/**
 * The words a Thread's context label and its log's context lines use (spec §2.5): what the next
 * message does to the session, and why. "Continuing · cache warm · 41k context";
 * "Fresh · cache expired, 48k context · brief ~3k".
 */

export const MOVE_WORDS: Readonly<Record<ContextMove, string>> = {
  resume: "Continuing",
  fresh: "Fresh",
  "hand-off": "Hand-off",
};

export const OVERRIDE_WORDS: Readonly<Record<ContextOverride, string>> = {
  "start-fresh": "Start fresh",
  "continue-anyway": "Continue anyway",
};

/** What a choice does, for its button's hint. */
export const OVERRIDE_HINTS: Readonly<Record<ContextOverride, string>> = {
  "start-fresh": "End this session and start a fresh one with a brief",
  "continue-anyway": "Resume the previous session instead, re-caching its context",
};

/** "41k" for 41,234 tokens and "1.2M" past a million; small counts as they are. */
export function tokensShort(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 10_000) return `${oneDecimal(tokens / 1_000)}k`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  return `${oneDecimal(tokens / 1_000_000)}M`;
}

function oneDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

/** What a move and its reason read as, after the move's own word. */
export function contextDetail(
  {
    move,
    reason,
    contextTokens,
    briefTokens,
  }: Pick<ThreadContext, "move" | "reason" | "contextTokens" | "briefTokens">,
  personName: string,
): string {
  const parts = [reasonWords(reason, contextTokens, personName)];
  if (move === "resume" && reason !== "cache-expired")
    parts.push(`${tokensShort(contextTokens)} context`);
  if (move !== "resume" && briefTokens !== null) parts.push(`brief ~${tokensShort(briefTokens)}`);
  return parts.join(" · ");
}

/** The whole label: "Continuing · cache warm · 41k context". */
export function contextLabel(
  context: Pick<ThreadContext, "move" | "reason" | "contextTokens" | "briefTokens">,
  personName: string,
): string {
  return `${MOVE_WORDS[context.move]} · ${contextDetail(context, personName)}`;
}

function reasonWords(reason: ContextReason, contextTokens: number, personName: string): string {
  switch (reason) {
    case "new-thread":
      return "new Thread";
    case "another-person":
      return "another person";
    case "cache-warm":
      return "cache warm";
    case "small-context":
      return "cache expired, small context";
    case "cache-expired":
      return `cache expired, ${tokensShort(contextTokens)} context`;
    case "session-default":
      return `${personName}'s session default`;
    case "your-choice":
      return "you chose it";
    case "stage-declared":
      return "as the Stage declares";
    case "context-full":
      return "context full, Handover note written";
    case "engine-changed":
      return "engine changed";
  }
}
