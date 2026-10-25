/** One step of a Pipeline (spec §2.3): work by an Agent in a Role, a Project command, or a Gate. */
export type Stage = AgentStage | ScriptStage | Gate;

export type StageKind = Stage["kind"];

/**
 * The Project command a Script Stage runs. `publish` is the Project's publishing mode, run by The
 * Office's own git code rather than a command string (spec §9).
 */
export type ScriptStageCommand = "build" | "lint" | "test" | "publish";

/** Fresh with a Brief, or continuing the previous Stage's session when the same Role worked it. */
export type StageSession = "fresh" | "continue";

/**
 * "On failure go back to Stage X, at most N times": a Pipeline's only control flow. Its rounds are
 * the Stage's round limit; once they are used up, the Task goes to the user.
 */
export interface OnFailure {
  /** The key of an earlier Stage that isn't a Gate. */
  readonly goBackTo: string;
  readonly rounds: number;
}

interface StageFields {
  /** Names the Stage within its Pipeline and stays when the Stage is renamed. */
  readonly key: string;
  readonly name: string;
  /** Skipped when the Definition of Done is already met. */
  readonly optional: boolean;
}

export interface AgentStage extends StageFields {
  readonly kind: "agent";
  /** The key of the Role that works it. */
  readonly role: string;
  /** Plain words, filled with the Task's Plan, Definition of Done and earlier results. */
  readonly brief: string;
  readonly session: StageSession;
  /** Tokens the Stage may use; reaching them asks the user. */
  readonly budget: number;
  readonly onFailure?: OnFailure;
}

export interface ScriptStage extends StageFields {
  readonly kind: "script";
  readonly command: ScriptStageCommand;
  readonly onFailure?: OnFailure;
}

/** The Task waits for the user to look at the work so far and let it continue. */
export interface Gate extends StageFields {
  readonly kind: "gate";
}
