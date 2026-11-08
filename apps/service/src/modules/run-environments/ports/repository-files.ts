/**
 * A Project's files as committed, read from its repository's objects; refusals come as
 * `RunEnvironmentSettingRefused`.
 */
export abstract class RepositoryFiles {
  /** The base branch's last commit fetched, with no fetch now; undefined when there is none. */
  abstract lastFetchedBase(projectId: string): Promise<string | undefined>;

  /** The base branch's commit fetched now, or the last one known when the fetch fails. */
  abstract freshBase(projectId: string): Promise<string>;

  /** Where the Task's branch points; undefined when it has none. */
  abstract taskBranchTip(projectId: string, taskId: string): Promise<string | undefined>;

  /** The text of the file `path` names at `commit`; undefined when it names no file there. */
  abstract textAt(projectId: string, commit: string, path: string): Promise<string | undefined>;
}
