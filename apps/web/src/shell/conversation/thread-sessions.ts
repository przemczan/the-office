import type { Message } from "@the-office/contracts";
import type { LogPiece } from "./message-groups.ts";

export type ContextLineMessage = Extract<Message, { kind: "context" }>;

/** One session of a Thread's log (spec §2.5): what was said from its context line to the next's. */
export interface ThreadSession {
  /** Its opening line's id, or `first` for the Thread's first session, so it stays as it grows. */
  readonly id: string;
  /** The line that started it after an earlier session; null for the Thread's first. */
  readonly opening: ContextLineMessage | null;
  /** What was said in it, its opening line left out. */
  readonly messages: readonly Message[];
  /**
   * How large its context was when it ended, as the next session's line says; null while it is the
   * Thread's current one, or when that line has no figure.
   */
  readonly endedAtTokens: number | null;
}

/** A session's place in the log: its pieces, and the lines just before its opening line. */
export interface SessionPieces {
  readonly session: ThreadSession;
  /** Lines between the session before and this one's opening line, such as a new day's. */
  readonly before: readonly LogPiece[];
  /** Its pieces, its opening line left out. */
  readonly pieces: readonly LogPiece[];
}

/**
 * A Thread's log split into its sessions: a context line that started a new session (a fresh start
 * or a hand-off) after an earlier one opens the next. The Thread's first context line opens its
 * first session, so it splits nothing, and a line that continued the session splits nothing either.
 */
export function threadSessions(messages: readonly Message[]): ThreadSession[] {
  const sessions: { id: string; opening: ContextLineMessage | null; messages: Message[] }[] = [
    { id: "first", opening: null, messages: [] },
  ];
  let started = false;
  for (const message of messages) {
    if (message.kind === "context") {
      if (started && message.move !== "resume") {
        sessions.push({ id: message.id, opening: message, messages: [] });
        continue;
      }
      started = true;
    }
    sessions.at(-1)?.messages.push(message);
  }
  return sessions.map((session, index) => ({
    ...session,
    endedAtTokens: endedAt(sessions[index + 1]?.opening),
  }));
}

function endedAt(nextOpening: ContextLineMessage | null | undefined): number | null {
  if (!nextOpening || nextOpening.contextTokens <= 0) return null;
  return nextOpening.contextTokens;
}

/**
 * The log's pieces shared out among the sessions, each session's opening line taken out of them.
 * Lines right before an opening line, such as a new day's, go before it rather than into the
 * session before.
 */
export function piecesBySession(
  pieces: readonly LogPiece[],
  sessions: readonly ThreadSession[],
): SessionPieces[] {
  const shared = sessions.map((session) => ({
    session,
    before: [] as LogPiece[],
    pieces: [] as LogPiece[],
  }));
  const openings = new Map(
    sessions.flatMap(({ opening }, index): [string, number][] =>
      opening ? [[opening.id, index]] : [],
    ),
  );
  let current = shared[0];
  for (const piece of pieces) {
    const opens = piece.kind === "alone" ? openings.get(piece.message.id) : undefined;
    const next = opens === undefined ? undefined : shared[opens];
    if (!next || !current) {
      current?.pieces.push(piece);
      continue;
    }
    const linesAtEnd = trailingLines(current.pieces);
    current.pieces.splice(current.pieces.length - linesAtEnd.length);
    next.before.push(...linesAtEnd);
    current = next;
  }
  return shared;
}

function trailingLines(pieces: readonly LogPiece[]): LogPiece[] {
  const last = pieces.findLastIndex((piece) => piece.kind !== "line");
  return pieces.slice(last + 1);
}
