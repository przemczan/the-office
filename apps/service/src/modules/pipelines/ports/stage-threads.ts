import type { CommandPermission } from "../domain/allowed-commands.js";
import type { StageSession } from "../domain/stage.js";

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
  readonly declared: StageSession;
  /** The Stage Thread of the Task's previous Stage run, when an Agent worked it. */
  readonly previousThreadId: string | undefined;
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
}

/** A Stage's session at work in its Stage Thread, until the Stage ends it. */
export interface StageThread {
  readonly threadId: string;
  /** The person's turn running now, as it ends. */
  nextTurn(): Promise<StageTurn>;
  /** Logs `why`, sends the person `text` in the same session, and returns the turn answering it. */
  send(text: string, why: string): Promise<StageTurn>;
  /** Ends the session and the Stage's work in the Thread. */
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
