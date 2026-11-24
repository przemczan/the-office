import type { ActionRunUser, TestTargetRunState } from "../domain/action-run.js";

/** A Test target run's test instance as the run follows it. */
export interface RunTestInstance {
  readonly id: string;
  readonly state: TestTargetRunState;
  readonly commit: string | undefined;
  readonly failedReason: string | undefined;
}

/** A test instance's move, or the commit it recorded. */
export interface TestInstanceMove {
  readonly instanceId: string;
  /** The state it moved to; undefined for a recorded commit. */
  readonly to?: TestTargetRunState;
  readonly failedReason?: string | undefined;
  /** The user's Stop moved it. */
  readonly stoppedByUser?: boolean;
  readonly commit?: string;
}

/**
 * Test instances' side of a Test target run (spec §2.15, "Kinds"): the launch, run as the Action,
 * by Test instances' rules (a refusal, such as Test instances at once, is an ActionRunRefused in
 * its words), its stop by the user and its log.
 */
export abstract class ActionTestInstances {
  abstract launch(
    projectId: string,
    branch: string,
    targetKey: string,
    by: ActionRunUser,
    runAs: { readonly actionKey: string; readonly actionName: string },
  ): Promise<RunTestInstance>;

  abstract read(id: string): Promise<RunTestInstance>;

  /** The user's Stop on the run stops its instance. */
  abstract stop(id: string): Promise<RunTestInstance>;

  /**
   * Calls `listener` with each move of a test instance and each commit one records, whatever
   * launched it, from now on.
   */
  abstract onMoved(listener: (move: TestInstanceMove) => void): void;

  abstract readLog(
    id: string,
    from: number,
  ): Promise<{ readonly text: string; readonly nextOffset: number }>;
}
