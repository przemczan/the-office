import type {
  ContextMove,
  ContextOverride,
  ContextReason,
  ThreadContext,
} from "@the-office/contracts";

/**
 * The words of what the next message does to the session, and why (spec §2.5). Under the composer:
 * "Continues · cache warm, 41 min left · 41k context". In the log's context lines:
 * "Continuing · cache warm · 41k context"; "Fresh · cache expired, 48k context · brief ~3k".
 */

export const MOVE_WORDS: Readonly<Record<ContextMove, string>> = {
  resume: "Continuing",
  fresh: "Fresh",
  "hand-off": "Hand-off",
};

/** What the user picks for the next message; Auto is the Context policy's choice. */
export type ContextChoice = "auto" | "continue" | "fresh";

export const CONTEXT_CHOICES: readonly { readonly value: ContextChoice; readonly label: string }[] =
  [
    { value: "auto", label: "Auto" },
    { value: "continue", label: "Continue" },
    { value: "fresh", label: "Start fresh" },
  ];

const OVERRIDE_OF_CHOICE: Readonly<Record<ContextChoice, ContextOverride | null>> = {
  auto: null,
  continue: "continue-anyway",
  fresh: "start-fresh",
};

export function overrideOf(choice: ContextChoice): ContextOverride | null {
  return OVERRIDE_OF_CHOICE[choice];
}

export function contextChoiceOf(override: ContextOverride | null): ContextChoice {
  if (override === null) return "auto";
  return override === "start-fresh" ? "fresh" : "continue";
}

/** The prompt cache of the Thread's session: none before it has one of this person's. */
export type CacheState =
  | { readonly kind: "none" }
  | { readonly kind: "warm"; readonly minutesLeft: number }
  | { readonly kind: "cold" };

/** Spec §2.5's hour; the service's `cacheLifetimeMs` is what sets `cacheWarmUntil`. */
const CACHE_HOUR_MINUTES = 60;

/**
 * Counted from `cacheWarmUntil`, so the mark goes on moving between readings of the Thread. `now`
 * can be behind that time's clock: it is the browser's, and `useClock`'s last tick can be older
 * than the call that warmed the cache. Hence the bound.
 */
export function cacheStateAt(
  { reason, cacheWarmUntil }: Pick<ThreadContext, "reason" | "cacheWarmUntil">,
  now: Date,
): CacheState {
  if (reason === "new-thread" || reason === "another-person") return { kind: "none" };
  const left = cacheWarmUntil === null ? 0 : Date.parse(cacheWarmUntil) - now.getTime();
  if (left <= 0) return { kind: "cold" };
  return { kind: "warm", minutesLeft: Math.min(Math.ceil(left / 60_000), CACHE_HOUR_MINUTES) };
}

export function startsASessionWords(briefTokens: number): string {
  return `Starts a session with a ${briefCost(briefTokens)}`;
}

function briefCost(briefTokens: number): string {
  return `Brief ~${tokensShort(briefTokens)} tokens`;
}

type ChoiceContext = Pick<
  ThreadContext,
  "move" | "reason" | "contextTokens" | "briefTokens" | "alternatives" | "override"
>;

/** A session to choose about; a new Thread, a hand-off or a full context have none. */
export function offersAChoice({ alternatives }: Pick<ThreadContext, "alternatives">): boolean {
  return alternatives.length > 0;
}

/** What the next message does under the choice, and what that costs. */
export function contextChoiceWords(
  context: ChoiceContext,
  choice: ContextChoice,
  cache: CacheState,
  personName: string,
): string {
  const size = `${tokensShort(context.contextTokens)} context`;
  const brief = briefCost(freshBriefTokens(context));
  if (choice === "fresh") return `Starts fresh · ${brief}`;
  if (cache.kind === "warm") {
    return `Continues · cache warm, ${cache.minutesLeft} min left · ${size}`;
  }
  if (choice === "continue") {
    return `Continues anyway · cache cold, so the ${size} is read again in full`;
  }
  // The move shown is the user's, so what the policy would do with a cold cache isn't known here.
  if (context.override !== null) return "Back to the Context policy's choice";
  if (context.reason === "session-default") {
    const sessionDefault = `${personName}'s session default`;
    return context.move === "resume"
      ? `Continues · ${sessionDefault} · ${size}`
      : `Starts fresh · ${sessionDefault} · ${brief}`;
  }
  return context.move === "resume"
    ? `Continues · cache cold, but only ${size}`
    : `Starts fresh · cache cold, ${size} · ${brief}`;
}

/** The Brief's estimate: the context's own while the move starts fresh, else the alternative's. */
function freshBriefTokens({ briefTokens, alternatives }: ChoiceContext): number {
  const startingFresh = alternatives.find(({ override }) => override === "start-fresh");
  return briefTokens ?? startingFresh?.tokens ?? 0;
}

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
    case "changes-switched":
      return "Allow changes switched";
  }
}
