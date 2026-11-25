import type { TestInstance, TestInstanceChange } from "../domain/test-instance.js";

/**
 * One test target's builds: those linked to one Initiative, or those on one branch linked to
 * none (spec §2.12, "Kept Build to install files").
 */
export type BuildsOf =
  | { readonly projectId: string; readonly targetKey: string; readonly initiativeId: string }
  | { readonly projectId: string; readonly targetKey: string; readonly branch: string };

/** The Test instances' rows, kept with their logs after they end. */
export abstract class TestInstanceRepository {
  abstract add(instance: TestInstance): Promise<void>;

  abstract find(id: string): Promise<TestInstance | undefined>;

  /** The Initiative's instances, newest first. */
  abstract listOf(initiativeId: string): Promise<readonly TestInstance[]>;

  /** Every instance of the Project, linked to an Initiative or not, newest first. */
  abstract listOfProject(projectId: string): Promise<readonly TestInstance[]>;

  /** Every instance Building, Installing or Running, across The Office. */
  abstract active(): Promise<readonly TestInstance[]>;

  /** Every instance Built or Failed across The Office that ended at or after `at`, newest first. */
  abstract endedSince(at: Date): Promise<readonly TestInstance[]>;

  /**
   * Every Built instance whose files are still kept, across The Office, or only one target's
   * builds when named; newest first.
   */
  abstract builtWithFiles(of?: BuildsOf): Promise<readonly TestInstance[]>;

  /**
   * The target's newest Built instance on the branch, linked to an Initiative or not, its files
   * kept or not; undefined when it has none (spec §2.12, "Reusing Built files").
   */
  abstract newestBuilt(
    projectId: string,
    targetKey: string,
    branch: string,
  ): Promise<TestInstance | undefined>;

  /**
   * Applies `change` to the instance as kept, holding its row so two changes never lose one;
   * answers what it made, or undefined when there is no such instance or nothing changed.
   */
  abstract update(
    id: string,
    change: (instance: TestInstance) => TestInstanceChange,
  ): Promise<TestInstanceChange>;
}
