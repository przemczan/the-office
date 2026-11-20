import { join } from "node:path";

/** The folders of the Office data directory (AGENTS.md, Project layout and defaults). */
export type OfficeDataFolder =
  | "worktrees"
  | "bases"
  | "initiative-bases"
  | "sessions"
  | "skills"
  | "attachments"
  | "project-images"
  | "avatars"
  | "identity"
  | "repositories"
  | "engines"
  | "run-environments"
  | "test-output"
  | "stage-runs"
  | "grafana";

/** Where The Office keeps its files outside the database: OFFICE_DATA_DIR or the system's default. */
export class OfficeDataDirectory {
  constructor(readonly path: string) {}

  folder(name: OfficeDataFolder): string {
    return join(this.path, name);
  }

  /**
   * The Task's folder of the file of its earlier Stage runs, which a condition command reads
   * (spec §2.3): written by Pipelines, mounted read-only in the Task's run environment.
   */
  stageRunsFolder(taskId: string): string {
    return join(this.folder("stage-runs"), taskId);
  }
}
