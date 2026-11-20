import type { StageRun, Thread } from "@the-office/contracts";
import { tokensShort } from "./context-words.ts";

/**
 * The context reading: a session's context size against its model's window, at the right end of
 * the row above the message input (spec §2.5, docs/design/session-context.html). "41k of 200k" with
 * a meter whose mark stands where The Office asks for a Handover note; on a Stage Thread, marks at its
 * soft and hard limits instead.
 */

/** Where The Office asks for a Handover note, as the service's `handOverAtShare` sets it. */
const HAND_OVER_AT_SHARE = 0.8;
/** A person's Thread turns amber from here, nearing the hand-off. */
const NEAR_SHARE = 0.7;

/**
 * Which row widths show a part: `wide` from 520px only, `not-narrow` all but a phone's (under
 * 400px), `narrow` a phone's alone.
 */
export type ReadingShown = "always" | "wide" | "not-narrow" | "narrow";

export interface ReadingPart {
  readonly text: string;
  /** The figure, in the strong weight. */
  readonly strong?: boolean;
  readonly shown: ReadingShown;
}

/** A Stage Thread's limit on the meter: where it stands, and what it reads, "Soft limit 100k". */
export interface ReadingLimitMark {
  readonly share: number;
  readonly label: string;
}

/**
 * The meter under the words: filled to `share`, or empty and dashed when nothing was read. `mark`
 * is a chat's hand-over mark at 80%; `limits` a Stage Thread's soft and hard limits.
 */
export type ReadingMeter =
  | {
      readonly kind: "filled";
      readonly share: number;
      readonly mark: boolean;
      readonly limits?: readonly ReadingLimitMark[];
    }
  | { readonly kind: "empty"; readonly mark: boolean };

export interface ContextReadingLook {
  readonly parts: readonly ReadingPart[];
  /** Undefined where there is nothing to measure against. */
  readonly meter: ReadingMeter | undefined;
  /** Amber: near the hand-off, or past it. Never red: a fresh start is the policy working. */
  readonly near: boolean;
  /** Quieter: no size to show. */
  readonly quiet: boolean;
  /** What a screen reader and the focus stop say: "Context: 41k of 200k". */
  readonly label: string;
  /** The Tooltip, saying it whole. */
  readonly tip: string;
}

/** The reading of a Thread that takes messages, from what GET /threads/:id gives. */
export function threadReadingLook(
  {
    context,
    state,
    stageThread,
    stageContextLimits,
  }: Pick<Thread, "context" | "state" | "stageThread" | "stageContextLimits">,
  personName: string,
): ContextReadingLook {
  const { reason, contextTokens: tokens, contextWindow: window, contextReported } = context;
  const answering = state === "answering";
  if (!contextReported) return notReported();
  if (reason === "new-thread" || reason === "another-person") {
    return quiet("No session yet", { kind: "empty", mark: true }, noSessionTip(personName));
  }
  if (reason === "context-full") {
    return answering ? handingOver(tokens, personName) : freshNext(tokens, personName);
  }
  if (window === null) {
    return tokens === 0
      ? quiet("Not read yet", { kind: "empty", mark: !stageThread }, notReadYetTip(personName))
      : sizeOnly(tokens, personName);
  }
  const share = tokens / window;
  const handOverAt = Math.round(window * HAND_OVER_AT_SHARE);
  if (stageThread) {
    const read = readWords(tokens, window, personName, answering);
    if (stageContextLimits === null) {
      return sized(tokens, window, {
        near: share >= HAND_OVER_AT_SHARE,
        mark: false,
        extra: undefined,
        tip: `${read}.`,
      });
    }
    const { soft, hard } = stageContextLimits;
    const limits = [
      { share: shareOf(soft, window), label: limitLabel("soft", soft) },
      { share: shareOf(hard, window), label: limitLabel("hard", hard) },
    ];
    const reading = sized(tokens, window, {
      near: tokens >= soft,
      mark: false,
      extra: undefined,
      tip: `${read}. ${limits.map(({ label }) => label).join(" · ")}: past the soft limit The Office asks ${personName} to finish the part and hand over; at the hard limit it stops the turn and asks at once. The Stage goes on in a fresh session.`,
    });
    return {
      ...reading,
      meter: { kind: "filled", share: shareOf(tokens, window), mark: false, limits },
      label: `${reading.label}, ${limits.map(({ label }) => label.toLowerCase()).join(", ")}`,
    };
  }
  const pastMark = share >= HAND_OVER_AT_SHARE;
  return sized(tokens, window, {
    near: share >= NEAR_SHARE,
    mark: true,
    extra: pastMark
      ? "Handover note at this turn's end"
      : share >= NEAR_SHARE
        ? `starts fresh at ${tokensShort(handOverAt)}`
        : undefined,
    tip: `${readWords(tokens, window, personName, answering)}. ${
      pastMark && answering
        ? `Past ${tokensShort(handOverAt)} (80%): when this turn ends, The Office asks ${personName} for a Handover note and the next message starts a fresh session.`
        : `At ${tokensShort(handOverAt)} (80%), The Office asks ${personName} for a Handover note and the next message starts a fresh session.`
    }`,
  });
}

/**
 * An ended run's reading, kept with the run: its session's size after its last turn, as a later run
 * resuming the session moves its Thread's on. A Stage's Thread has no mark, as its session isn't
 * started fresh mid-run.
 */
export function endedRunReadingLook(
  { context }: Pick<StageRun, "context">,
  personName: string,
): ContextReadingLook {
  if (context === null) {
    return quiet(
      "Not read",
      { kind: "empty", mark: false },
      `The run ended before ${personName}'s session was read.`,
    );
  }
  const { contextTokens: tokens, contextWindow: window } = context;
  return {
    parts: [
      { text: "Ended at ", shown: "not-narrow" },
      { text: tokensShort(tokens), strong: true, shown: "always" },
      { text: ` of ${tokensShort(window)}`, shown: "always" },
    ],
    meter: { kind: "filled", share: shareOf(tokens, window), mark: false },
    near: tokens / window >= HAND_OVER_AT_SHARE,
    quiet: false,
    label: `Context: ended at ${tokensShort(tokens)} of ${tokensShort(window)}`,
    tip: `${tokensWhole(tokens, window)}, ${personName}'s session after the run's last turn.`,
  };
}

/** "Soft limit 100k", "Hard limit 180k". */
function limitLabel(limit: "soft" | "hard", tokens: number): string {
  return `${limit === "soft" ? "Soft" : "Hard"} limit ${tokensShort(tokens)}`;
}

function sized(
  tokens: number,
  window: number,
  {
    near,
    mark,
    extra,
    tip,
  }: {
    readonly near: boolean;
    readonly mark: boolean;
    readonly extra: string | undefined;
    readonly tip: string;
  },
): ContextReadingLook {
  return {
    parts: [
      { text: tokensShort(tokens), strong: true, shown: "always" },
      { text: ` of ${tokensShort(window)}`, shown: "always" },
      extra === undefined
        ? { text: " context", shown: "wide" }
        : { text: ` · ${extra}`, shown: "wide" },
    ],
    meter: { kind: "filled", share: shareOf(tokens, window), mark },
    near,
    quiet: false,
    label: `Context: ${tokensShort(tokens)} of ${tokensShort(window)}`,
    tip,
  };
}

/** A session read before its window was kept: its size alone, until its next turn. */
function sizeOnly(tokens: number, personName: string): ContextReadingLook {
  return {
    parts: [
      { text: tokensShort(tokens), strong: true, shown: "always" },
      { text: " context", shown: "always" },
    ],
    meter: undefined,
    near: false,
    quiet: false,
    label: `Context: ${tokensShort(tokens)}`,
    tip: `${tokensShort(tokens)} tokens in ${personName}'s session. Its window shows after the next turn.`,
  };
}

function handingOver(tokens: number, personName: string): ContextReadingLook {
  return {
    parts: [
      { text: "Writing a Handover note", shown: "not-narrow" },
      { text: "Handing over", shown: "narrow" },
      { text: ` · ${tokensShort(tokens)}`, shown: "not-narrow" },
    ],
    meter: undefined,
    near: true,
    quiet: false,
    label: `Context: ${personName} is writing a Handover note at ${tokensShort(tokens)}`,
    tip: `${personName}'s session reached ${tokensShort(tokens)}, past 80% of its window: ${personName} writes a Handover note, and the next message starts a fresh session with it.`,
  };
}

function freshNext(tokens: number, personName: string): ContextReadingLook {
  return {
    parts: [
      { text: "Fresh session next", shown: "always" },
      { text: ` · was ${tokensShort(tokens)}`, shown: "not-narrow" },
    ],
    meter: { kind: "empty", mark: true },
    near: false,
    quiet: true,
    label: `Context: fresh session next, was ${tokensShort(tokens)}`,
    tip: `${personName}'s last session ended at ${tokensShort(tokens)} with a Handover note. The next message starts a fresh session with it.`,
  };
}

function notReported(): ContextReadingLook {
  return quiet(
    "Context size not reported",
    undefined,
    "This session's engine can't report how full its context is.",
  );
}

function quiet(text: string, meter: ReadingMeter | undefined, tip: string): ContextReadingLook {
  return {
    parts: [{ text, shown: "always" }],
    meter,
    near: false,
    quiet: true,
    label: `Context: ${text.toLowerCase()}`,
    tip,
  };
}

function noSessionTip(personName: string): string {
  return `The next message starts a session with ${personName}. Its size shows once the model has answered.`;
}

function notReadYetTip(personName: string): string {
  return `${personName}'s session started. Its size shows once the model has answered.`;
}

function readWords(tokens: number, window: number, personName: string, live: boolean): string {
  return `${tokensWhole(tokens, window)}, ${
    live ? `read live as ${personName} answers` : `read after ${personName}'s last turn`
  }`;
}

/** "41,234 of 200,000 tokens (21%)". */
function tokensWhole(tokens: number, window: number): string {
  const percent = Math.round((tokens / window) * 100);
  return `${tokens.toLocaleString("en-US")} of ${window.toLocaleString("en-US")} tokens (${percent}%)`;
}

function shareOf(tokens: number, window: number): number {
  return Math.min(1, tokens / window);
}
