import type { TestInstance, TestInstanceChange } from "../domain/test-instance.js";

/** One test target's builds on one Initiative. */
export interface BuildsOf {
  readonly initiativeId: string;
  readonly projectId: string;
  readonly targetKey: string;
}

/** The Test instances' rows, kept with their logs after they end. */
export abstract class TestInstanceRepository {
  abstract add(instance: TestInstance): Promise<void>;

  abstract find(id: string): Promise<TestInstance | undefined>;

  /** The Initiative's instances, newest first. */
  abstract listOf(initiativeId: string): Promise<readonly TestInstance[]>;

  /** Every instance Building or Running, across The Office. */
  abstract active(): Promise<readonly TestInstance[]>;

  /**
   * Every Built instance whose files are still kept, across The Office, or only one target's on
   * one Initiative when named; newest first.
   */
  abstract builtWithFiles(of?: BuildsOf): Promise<readonly TestInstance[]>;

  /**
   * Applies `change` to the instance as kept, holding its row so two changes never lose one;
   * answers what it made, or undefined when there is no such instance or nothing changed.
   */
  abstract update(
    id: string,
    change: (instance: TestInstance) => TestInstanceChange,
  ): Promise<TestInstanceChange>;
}
