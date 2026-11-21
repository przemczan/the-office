import type { TestInstance, TestInstanceChange } from "../domain/test-instance.js";

/** The Test instances' rows, kept with their logs after they end. */
export abstract class TestInstanceRepository {
  abstract add(instance: TestInstance): Promise<void>;

  abstract find(id: string): Promise<TestInstance | undefined>;

  /** The Initiative's instances, newest first. */
  abstract listOf(initiativeId: string): Promise<readonly TestInstance[]>;

  /** Every instance Building or Running, across The Office. */
  abstract active(): Promise<readonly TestInstance[]>;

  /**
   * Applies `change` to the instance as kept, holding its row so two changes never lose one;
   * answers what it made, or undefined when there is no such instance or nothing changed.
   */
  abstract update(
    id: string,
    change: (instance: TestInstance) => TestInstanceChange,
  ): Promise<TestInstanceChange>;
}
