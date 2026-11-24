import type { ActionRun } from "../domain/action-run.js";

/** A change to a run: the run as it becomes; undefined when nothing would change. */
export type ActionRunChange = (run: ActionRun) => ActionRun | undefined;

/** One Action running already: its one running run blocks another (spec §2.15, "Limits"). */
export class ActionRunningAlready extends Error {
  constructor(
    readonly projectId: string,
    readonly actionKey: string,
  ) {
    super(`The Action ${actionKey} of ${projectId} has a running run already.`);
    this.name = "ActionRunningAlready";
  }
}

/** The Action runs, kept with their logs; the newest 20 of each Action. */
export abstract class ActionRunRepository {
  /** Adds the run; throws ActionRunningAlready when its Action has a running run already. */
  abstract add(run: ActionRun): Promise<void>;

  abstract find(id: string): Promise<ActionRun | undefined>;

  /** The Project's runs, newest first. */
  abstract listOfProject(projectId: string): Promise<readonly ActionRun[]>;

  /** One Action's runs, newest first. */
  abstract listOfAction(projectId: string, actionKey: string): Promise<readonly ActionRun[]>;

  /** Every running run, oldest first. */
  abstract running(): Promise<readonly ActionRun[]>;

  /** The Test target run of the instance; undefined when no run launched it. */
  abstract ofTestInstance(instanceId: string): Promise<ActionRun | undefined>;

  /**
   * Applies `change` to the run as it is now, holding it so two changes never lose one; answers
   * the run before and after, or undefined when there is none or nothing changed.
   */
  abstract update(
    id: string,
    change: ActionRunChange,
  ): Promise<{ readonly before: ActionRun; readonly after: ActionRun } | undefined>;

  abstract remove(ids: readonly string[]): Promise<void>;
}
