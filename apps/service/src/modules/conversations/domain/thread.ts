import type { EngineId } from "../../engine/index.js";
import type { Decision } from "./decision.js";

/**
 * Where a conversation lives (spec §2.4): a person's chat, a Task's conversation, or an
 * Initiative's, where the CTO shapes it with the user.
 */
export type Home =
  | { readonly kind: "chat"; readonly roleKey: string }
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "initiative"; readonly initiativeId: string };

/** Whether the person is answering in the Thread, or it waits for the user's next message. */
export type ThreadState = "waiting" | "answering";

/** A Thread's tokens over all its turns, split as the engine reports them. */
export interface TokenTotals {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
}

export const NO_TOKENS: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

export function addTokens(total: TokenTotals, turn: TokenTotals): TokenTotals {
  return {
    input: total.input + turn.input,
    output: total.output + turn.output,
    cacheRead: total.cacheRead + turn.cacheRead,
    cacheCreation: total.cacheCreation + turn.cacheCreation,
  };
}

/**
 * A person's own Thread on a Task, for asking them about it (spec §2.4): neither a Stage's nor a
 * Consultation's. The Planner's is the Planning Thread.
 */
export function isPersonsThread({ home, stageThread, consultation }: Thread): boolean {
  return home.kind === "task" && !stageThread && !consultation;
}

/** The Thread's tokens as the user sees them: its ended turns and the running turn's so far. */
export function tokensSoFar({ tokens, runningTurnTokens }: Thread): TokenTotals {
  return addTokens(tokens, runningTurnTokens);
}

/**
 * The engine session behind a Thread now. Only it can be resumed; starting fresh or handing off
 * replaces it, and the one before can't be resumed any more.
 */
export interface ThreadSession {
  /** The engine's session id, which a resume names. */
  readonly id: string;
  /** Whose session it is: a change of person is a hand-off (spec §2.5). */
  readonly roleKey: string;
  /** The Role card version it started with, which a resume runs with again. */
  readonly cardVersion: number;
  /** The engine it runs on, the only one that can resume it. */
  readonly engineId: EngineId;
  readonly startedAt: Date;
  /** When its last engine call ended, which tells whether the prompt cache is still warm. */
  readonly lastCallAt: Date | undefined;
  /** How large its context was after the last call. */
  readonly contextTokens: number;
  /**
   * Its context after its first turn: the engine's own prompt and tools, the Brief and the first
   * exchange, which a fresh session takes too. Undefined until that turn ends.
   */
  readonly startContextTokens: number | undefined;
  /**
   * The context neared its limit and The Office asked for a Handover note: the session is never
   * resumed, and the Thread continues fresh (spec §2.5).
   */
  readonly full: boolean;
  /**
   * It started with changes allowed in its Caretaker Thread, reaching the workstation (spec §2.4):
   * switching them on or off never resumes it, as it runs under other rules.
   */
  readonly changesAllowed: boolean;
}

/** What the user chose for the Thread's next message: "Start fresh" or "Continue anyway". */
export type ContextOverride = "start-fresh" | "continue-anyway";

/**
 * What makes a Thread a Consultation (spec §2.4): a sub-thread on a Task where a Consultant, whose
 * Role the Thread's `roleKey` is, answers the Decision an Agent, or The Office, put to them.
 */
export interface Consultation {
  readonly decisionId: string;
  /** The Thread the Decision was asked in, which waits on it. */
  readonly askerThreadId: string;
  /** The Agent who asked, by the key of their Role; undefined when The Office did (spec §2.3). */
  readonly askerRoleKey: string | undefined;
}

/** One continuous exchange in a home, one engine session underneath at a time. */
export interface Thread {
  readonly id: string;
  readonly home: Home;
  /** The person the user talks to in it, by the key of the Role they fill. */
  readonly roleKey: string;
  /** From its first message until the user renames it; undefined before any message. */
  readonly title: string | undefined;
  readonly state: ThreadState;
  /** Undefined until the person first answers in it. */
  readonly session: ThreadSession | undefined;
  /** For the next message only; undefined lets the Context policy choose. */
  readonly override: ContextOverride | undefined;
  /** The tokens of its ended turns, as the engine counted each turn. */
  readonly tokens: TokenTotals;
  /**
   * The running turn's tokens so far, counted from the person's messages as they come, so a long
   * turn shows live; the turn's own count replaces them as it ends. Budgets count `tokens` only.
   */
  readonly runningTurnTokens: TokenTotals;
  readonly startedAt: Date;
  /** The Decision the Thread waits on the user for: at most one is open at a time. */
  readonly openDecision: Decision | undefined;
  /**
   * A Stage Thread: an Agent works one of the Task's Stages in it, and The Office, not the user,
   * sends its messages.
   */
  readonly stageThread: boolean;
  /** Undefined unless this is a Consultation. */
  readonly consultation?: Consultation | undefined;
}
