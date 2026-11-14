import type { HoldingUser, RefusedTurn, StageInterruption, StageOutcome } from "./stage-run.js";

interface InterruptionRule {
  /** Whether it stops the Agent's running turn now, or waits for the turn to end. */
  readonly actsNow: boolean;
  /**
   * Whether it discards the Stage's uncommitted edits, or keeps them for the Stage to go on with.
   * Only the user's Stop discards them (spec §5.5).
   */
  readonly discardsEdits: boolean;
  /**
   * Whether it stops a Project command running for the Stage too. The user's Stop doesn't: the
   * command runs to its end (the user's answer of 2026-10-26); The Office shutting down can't wait.
   */
  readonly stopsCommands: boolean;
}

/** The one interrupted-run rule (spec §2.4), by kind. */
const RULES: Readonly<Record<StageInterruption, InterruptionRule>> = {
  pause: { actsNow: false, discardsEdits: false, stopsCommands: false },
  // The refused turn has ended already: the run is held as it stands, its commands left to end.
  "usage-window": { actsNow: false, discardsEdits: false, stopsCommands: false },
  // A Script Stage stops at once; an Agent's turn goes on to its safe point (spec §2.8).
  alarm: { actsNow: false, discardsEdits: false, stopsCommands: true },
  // The Office shutting down can't wait for the turn, but the Stage goes on with its edits.
  restart: { actsNow: true, discardsEdits: false, stopsCommands: true },
  stop: { actsNow: true, discardsEdits: true, stopsCommands: false },
};

/**
 * Weakest first: each asks more of a run than those before it. The user's Stop outranks a restart,
 * so a run they stopped still has its edits discarded as The Office shuts down.
 */
const RANKS: readonly StageInterruption[] = ["pause", "usage-window", "alarm", "restart", "stop"];

/**
 * What cut a held run's Agent turn short, before it ended by itself: The Office shutting down, or
 * the fire alarm's hard stop.
 */
export type CutShortBy = "restart" | "alarm";

export function actsNow(interruption: StageInterruption): boolean {
  return RULES[interruption].actsNow;
}

export function discardsEdits(interruption: StageInterruption): boolean {
  return RULES[interruption].discardsEdits;
}

export function stopsCommands(interruption: StageInterruption): boolean {
  return RULES[interruption].stopsCommands;
}

/**
 * Whether it holds the run once the Agent's turn ends, its edits kept: a Pause, the fire alarm or a
 * used-up usage window.
 */
export function waitsForTheTurn(interruption: StageInterruption | undefined): boolean {
  return interruption !== undefined && !actsNow(interruption);
}

/** Whether `interruption` asks more of a run than `asked` already did, so it replaces it. */
export function outranks(
  interruption: StageInterruption,
  asked: StageInterruption | undefined,
): boolean {
  return asked === undefined || RANKS.indexOf(interruption) > RANKS.indexOf(asked);
}

/**
 * How an interrupted run ends: failed, marked so the walk doesn't count a failure (spec §2.4,
 * §5.5). A Stop names what The Office discarded; a Pause, the fire alarm or a restart keeps the
 * worktree as the Agent left it, even once its turn was cut short. A Pause or a Stop names the
 * user who asked for it, `heldByUser`, when known.
 */
export function interruptedOutcome(
  interruption: StageInterruption,
  discardedPaths: readonly string[],
  {
    cutShortBy,
    refused,
    heldByUser,
  }: {
    readonly cutShortBy?: CutShortBy;
    readonly refused?: RefusedTurn;
    readonly heldByUser?: HoldingUser | undefined;
  } = {},
): StageOutcome {
  const byUser = heldByUser && byTheUser(interruption) ? { heldByUser } : {};
  if (cutShortBy && waitsForTheTurn(interruption)) {
    return cutShortOutcome(interruption, cutShortBy, byUser);
  }
  const error =
    interruption === "usage-window" && refused
      ? usedUpWords(refused)
      : errorOf(interruption, discardedPaths, heldByUser);
  return {
    status: "failed",
    error,
    interrupted: interruption,
    ...byUser,
    // Kept beside a stronger hold too, so the Stage is sent the refused message as it resumes.
    ...(refused && waitsForTheTurn(interruption) && { refused }),
  };
}

/** "Paused: Claude Code's 5-hour window is used up until 2026-11-13 14:00 UTC. …", the run's error. */
function usedUpWords({ engineName, windowWords, resetsAt }: RefusedTurn): string {
  return `Paused: ${engineName}'s ${windowWords} is used up until ${resetTime(resetsAt)}. The engine refused the Agent's turn, which is no failure: the Stage's uncommitted edits stay in the worktree, and it goes on in its own Thread once the window resets.`;
}

/** The reset as `YYYY-MM-DD HH:MM UTC`: the run's words are read on any machine. */
function resetTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * How a held run ends when its Agent's turn is cut short before it ends, by The Office shutting
 * down or the alarm's hard stop: the run is held as asked, its edits kept (the user's answer of
 * 2026-10-26), so no Decision opens and the Stage goes on with them.
 */
function cutShortOutcome(
  interruption: StageInterruption,
  cutShortBy: CutShortBy,
  byUser: { readonly heldByUser?: HoldingUser },
): StageOutcome {
  const cut =
    cutShortBy === "restart"
      ? "The Office restarted during the Agent's last turn and cut it short"
      : "Its hard stop cut the Agent's last turn short";
  return {
    status: "failed",
    error: `${heldWords(interruption, byUser.heldByUser)} ${cut}: the Stage's uncommitted edits stay in the worktree, maybe half-done, for it to go on with.`,
    interrupted: interruption,
    cutShort: true,
    ...byUser,
  };
}

function heldWords(interruption: StageInterruption, heldByUser: HoldingUser | undefined): string {
  if (interruption === "alarm") return "Held by the fire alarm.";
  return interruption === "usage-window"
    ? "Paused as the engine's usage window was used up."
    : `Paused by ${holdingUserWords(heldByUser)}.`;
}

/** Whether the user holds a run held so: by their Pause or their Stop. */
function byTheUser(interruption: StageInterruption): boolean {
  return interruption === "pause" || interruption === "stop";
}

/** "the user Ann Lee", or "the user" for a run held before users existed. */
export function holdingUserWords(heldByUser: HoldingUser | undefined): string {
  return heldByUser ? `the user ${heldByUser.name}` : "the user";
}

function errorOf(
  interruption: StageInterruption,
  discardedPaths: readonly string[],
  heldByUser: HoldingUser | undefined,
): string {
  const user = holdingUserWords(heldByUser);
  switch (interruption) {
    case "stop":
      return `Stopped by ${user}. ${discardedWords(discardedPaths.length)}`;
    case "pause":
      return `Paused by ${user}. The Stage's uncommitted edits stay in the worktree for it to go on with.`;
    case "alarm":
      return "Held by the fire alarm. The Stage's uncommitted edits stay in the worktree for it to go on with after the all clear.";
    case "restart":
      return "The Office restarted during this Stage, which cut it short. Its uncommitted edits stay in the worktree, and the Stage goes on with them by itself.";
    case "usage-window":
      return "Paused as the engine's usage window was used up. The Stage's uncommitted edits stay in the worktree for it to go on with once the window resets.";
  }
}

function discardedWords(count: number): string {
  if (count === 0) return "The Stage had left no uncommitted edits.";
  const files = count === 1 ? "1 file" : `${count} files`;
  return `The Office discarded the Stage's uncommitted edits to ${files}.`;
}

/**
 * The line a Stage's work in its Thread closes with: that the user held it with Pause or Stop, the
 * fire alarm did, or a used-up usage window, which is no failure (spec §2.3, §2.4, §2.8), or why it
 * failed. A restart closes as The Office ending the work, though the walk counts no failure for it.
 */
export type StageWorkClosing =
  | { readonly kind: "failure"; readonly reason: string }
  | {
      readonly kind: "held";
      readonly heldBy: Exclude<StageInterruption, "restart">;
      readonly text: string;
    };

const USAGE_WINDOW_HELD =
  "Held until the window resets: the Stage's uncommitted edits stay in the worktree, and it goes on in its own Thread then.";

/** The closing line of a run's outcome; undefined for a run that neither failed nor was held. */
export function closingOf(outcome: StageOutcome): StageWorkClosing | undefined {
  if (outcome.status !== "failed") return undefined;
  const { interrupted, error } = outcome;
  if (interrupted === undefined || interrupted === "restart")
    return { kind: "failure", reason: error };
  // The Thread's used-up line just before it names the window and its reset, in the reader's time.
  const text = interrupted === "usage-window" && outcome.refused ? USAGE_WINDOW_HELD : error;
  return { kind: "held", heldBy: interrupted, text };
}
