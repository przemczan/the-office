/**
 * Where a conversation lives (spec §2.4): a person's chat, or a Task's conversation. The Task's
 * comes with the Work module; an Initiative's with tier 2.
 */
export type Home =
  | { readonly kind: "chat"; readonly roleKey: string }
  | { readonly kind: "task"; readonly taskId: string };

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
  readonly startedAt: Date;
  /** When its last engine call ended, which tells whether the prompt cache is still warm. */
  readonly lastCallAt: Date | undefined;
  /** How large its context was after the last call. */
  readonly contextTokens: number;
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
  readonly tokens: TokenTotals;
  readonly startedAt: Date;
}
