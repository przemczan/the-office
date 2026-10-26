import type { CommandPermission } from "../domain/allowed-commands.js";
import type { StageSession } from "../domain/stage.js";
import type { StageSessionMove, StageTokens } from "../domain/stage-run.js";

/** What an Agent Stage gives its sessions, beside what the person's Role card does. */
export interface StageSessionSettings {
  /** What the person does in a Stage, added to their card's instructions; the same every Stage. */
  readonly instructions: string;
  readonly profile: {
    readonly edit: boolean;
    readonly run: CommandPermission;
    readonly web: boolean;
  };
  readonly officeTools: readonly string[];
  /** The result schema, the same every Stage, so it stays in the cached prefix. */
  readonly outputSchema: Readonly<Record<string, unknown>>;
}

/** An Agent Stage beginning in its Stage Thread. */
export interface StageThreadRequest {
  readonly taskId: string;
  /** The key of the Stage's Role, whose person works it. */
  readonly roleKey: string;
  readonly stageName: string;
  /**
   * The Stage's declared session; undefined lets the Context policy decide, as when the Stage runs
   * again after its Agent's question was answered: the answer goes to the asking session (spec §9).
   */
  readonly declared: StageSession | undefined;
  /** The Stage Thread of the Task's previous Stage run, when an Agent worked it. */
  readonly previousThreadId: string | undefined;
  /**
   * When the Stage runs again after the user held its last run: its start. The user's messages
   * into the previous Thread since then that its session ended before taking go with the work,
   * so a message and a Stop redirect the Agent (spec §2.4).
   */
  readonly carryMessagesSince: Date | undefined;
  /** The Task's record a new session's Brief starts with. */
  readonly record: string;
  /** What the Stage asks now: after the Brief, or alone in a continued session. */
  readonly work: string;
  /** The Task's worktree. */
  readonly folder: string;
  /** The Project's command environment. */
  readonly environment: Readonly<Record<string, string>>;
  readonly useProjectSkills: boolean;
  readonly session: StageSessionSettings;
}

/** How a turn of the person's ended. */
export interface StageTurn {
  /** The turn's result; undefined when the engine gave none. */
  readonly output: unknown;
  /** Why the engine ended the turn without finishing it. */
  readonly problem: string | undefined;
  /** The turn's tokens. */
  readonly tokens: StageTokens;
}

/** A Stage's session at work in its Stage Thread, until the Stage ends it. */
export interface StageThread {
  readonly threadId: string;
  /** The Context policy's move that began the Stage's session. */
  readonly move: { readonly move: StageSessionMove };
  /** The person's turn running now, as it ends. */
  nextTurn(): Promise<StageTurn>;
  /** Logs `why`, sends the person `text` in the same session, and returns the turn answering it. */
  send(text: string, why: string): Promise<StageTurn>;
  /**
   * Stops the person's running turn now (Stop, spec §2.4): it ends as an interrupted turn, or, on
   * an engine that can't interrupt, the session ends. Does nothing between turns.
   */
  interrupt(): Promise<void>;
  /**
   * Ends the session and every process it left running, such as a dev server or a watcher, so
   * nothing changes the worktree after it.
   */
  endSession(): Promise<void>;
  /** Ends the Stage's work in the Thread, and its session unless `endSession` has. */
  end(ending: {
    readonly handoverNote: string | undefined;
    readonly failure: string | undefined;
  }): Promise<void>;
}

/**
 * The Stage Threads on Tasks' conversations, which Conversations keeps; the composition root binds
 * it. It decides each Stage's session through the Context policy (spec §2.5).
 */
export abstract class StageThreads {
  abstract open(request: StageThreadRequest): Promise<StageThread>;
}
