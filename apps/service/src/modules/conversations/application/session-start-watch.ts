import type { LoggerService } from "@nestjs/common";
import type { Schedule, Wait } from "../../../platform/schedule/schedule.js";

/**
 * How long a session may give no event after its start began before the service log warns: long
 * enough for a slow refresh of the base branches and a cold engine start.
 */
export const SESSION_START_SILENCE_MS = 3 * 60 * 1000;

/** What opening a session is doing, as the service log names it. */
export type SessionStartStep =
  | "waiting for the previous session to end"
  | "refreshing the Thread's folders"
  | "preparing skills"
  | "preparing MCP servers"
  | "starting on the engine"
  | "waiting for the engine's first event";

/** The session a watch is on. */
export interface WatchedSessionStart {
  readonly threadId: string;
  readonly sessionId: string;
  readonly engineId: string;
  /** The person whose session it is, by their name. */
  readonly personName: string;
  readonly move: "start" | "resume";
}

/**
 * Writes a Thread's session opening into the service log, so a start that fails or hangs shows
 * there: a line as it begins, a warning if it has given no event `SESSION_START_SILENCE_MS` later,
 * with the step it is in, and an error naming the step that failed. It only logs: the Thread goes
 * on, or fails, as its runner says.
 */
export class SessionStartWatch {
  private step: SessionStartStep = "waiting for the previous session to end";
  private readonly began: Date;
  private readonly silence: Wait;
  private warned = false;
  private settled = false;

  constructor(
    private readonly start: WatchedSessionStart,
    private readonly schedule: Schedule,
    private readonly logger: Pick<LoggerService, "log" | "warn" | "error">,
  ) {
    this.began = schedule.now();
    const verb = start.move === "start" ? "starts" : "resumes";
    logger.log(
      `Thread ${start.threadId} ${verb} session ${start.sessionId} on the engine ${start.engineId} for ${start.personName}.`,
    );
    this.silence = schedule.once(
      `session ${start.sessionId}'s start`,
      new Date(this.began.getTime() + SESSION_START_SILENCE_MS),
      () => {
        this.warnSilent();
        return Promise.resolve();
      },
    );
  }

  /** The opening has moved on to `step`. */
  at(step: SessionStartStep): void {
    this.step = step;
  }

  /** The session gave its first event: it has started. */
  spoke(): void {
    if (!this.settle()) return;
    if (this.warned) {
      this.logger.log(
        `Thread ${this.start.threadId}'s session ${this.start.sessionId} spoke after ${this.secondsSinceStart()} s.`,
      );
    }
  }

  /**
   * The opening failed, or the session ended in error before its first event; false, logging
   * nothing, once it had spoken or ended.
   */
  failed(error: unknown): boolean {
    if (!this.settle()) return false;
    const { threadId, sessionId, personName, move } = this.start;
    this.logger.error(
      `Thread ${threadId}'s session ${sessionId} (${personName}) failed to ${move} while ${this.step}: ${messageOf(error)}`,
    );
    return true;
  }

  /** The session ended before its first event without an error, as when the Thread ends it. */
  ended(): void {
    this.settle();
  }

  /** Stops the wait for the first event; false when it had stopped already. */
  private settle(): boolean {
    if (this.settled) return false;
    this.settled = true;
    this.silence.cancel();
    return true;
  }

  private warnSilent(): void {
    if (this.settled) return;
    this.warned = true;
    const { threadId, sessionId, personName, move } = this.start;
    this.logger.warn(
      `Thread ${threadId}'s session ${sessionId} (${personName}) has given no event ${this.secondsSinceStart()} s after it was ${move === "start" ? "started" : "resumed"}; it is ${this.step}.`,
    );
  }

  private secondsSinceStart(): number {
    return Math.round((this.schedule.now().getTime() - this.began.getTime()) / 1000);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
