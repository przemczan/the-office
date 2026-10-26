import type { ContextMove, ContextReason } from "./context-policy.js";
import type { DecisionAnswer } from "./decision.js";

/**
 * What The Office's log of a Thread holds, which is what the UI shows (spec §2.4): the engine's
 * transcript stays the engine's.
 */
export type Message = MessageFields & MessageDraft;

interface MessageFields {
  readonly id: string;
  readonly threadId: string;
  readonly at: Date;
}

/** A message by its kind and fields alone, before the log gives it its id, Thread and time. */
export type MessageDraft =
  | { readonly kind: "user"; readonly text: string }
  | { readonly kind: "person"; readonly roleKey: string; readonly text: string }
  /** A few lines the person wrote for whoever continues, when The Office asked for them. */
  | { readonly kind: "handover-note"; readonly roleKey: string; readonly text: string }
  | ToolActivity
  | Refusal
  | DecisionCard
  | DecisionAnswerLine
  | ContextLine
  /** Why the person couldn't answer, in the engine's or The Office's words. */
  | { readonly kind: "failure"; readonly reason: string };

/**
 * The move the Context policy made as the person took a message, when it wasn't simply continuing
 * a warm session: The Office's line, never a person's (spec §9).
 */
interface ContextLine {
  readonly kind: "context";
  readonly move: ContextMove;
  readonly reason: ContextReason;
  readonly contextTokens: number;
  /** The Brief's estimate, when the move started a session with one. */
  readonly briefTokens: number | undefined;
  /** The Brief the session started with, for the user to read; undefined when there was none. */
  readonly brief: string | undefined;
}

/** Something the person did with a tool, such as reading a file. */
interface ToolActivity {
  readonly kind: "tool-activity";
  readonly roleKey: string;
  /** The engine's name for the tool, or an Office tool's. */
  readonly tool: string;
  /** What it did, in a line, such as the file it read. */
  readonly summary: string;
}

/** A tool call the Office rules or the engine refused, with the reason the person read. */
interface Refusal {
  readonly kind: "refusal";
  readonly roleKey: string;
  readonly tool: string;
  readonly reason: string;
}

/** A Decision the person opened, shown as its card; the Decision holds its question and answer. */
interface DecisionCard {
  readonly kind: "decision";
  readonly roleKey: string;
  readonly decisionId: string;
}

/**
 * The user answered a Decision, by an option or a free answer, which went into the session. The
 * line keeps the answer as given: a Decision whose answer never reached a session opens again.
 */
interface DecisionAnswerLine {
  readonly kind: "decision-answer";
  readonly decisionId: string;
  readonly answer: DecisionAnswer;
}
