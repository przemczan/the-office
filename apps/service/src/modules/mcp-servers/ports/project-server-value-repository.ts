import type { ProjectServerValue } from "../domain/project-server-values.js";

/** Where Projects' own Server values are kept, secrets among them. */
export abstract class ProjectServerValueRepository {
  /** The Project's values, for every server. */
  abstract ofProject(projectId: string): Promise<readonly ProjectServerValue[]>;

  /** Replaces the Project's values for the server with `values`. */
  abstract replace(
    projectId: string,
    serverName: string,
    values: readonly ProjectServerValue[],
  ): Promise<void>;

  /**
   * Every Project's values for the server, as `keep` keeps them after the server changed, held
   * against a Project's change meanwhile.
   */
  abstract updateAll(
    serverName: string,
    keep: (values: readonly ProjectServerValue[]) => readonly ProjectServerValue[],
  ): Promise<void>;
}
