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
  | "grafana"
  | "test-instances"
  | "test-builds"
  | "device-helper"
  | "action-runs";

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

  /**
   * A test instance's own detached checkout of the commit it launched (spec §5.5, "A test
   * instance's checkout"), removed when the instance stops, fails or is Built.
   */
  testInstanceFolder(instanceId: string): string {
    return join(this.folder("test-instances"), instanceId);
  }

  /**
   * An Action's Project command run's own detached checkout of the commit it runs (spec §5.5, "An
   * Action run's checkout"), removed as the run ends.
   */
  actionRunFolder(runId: string): string {
    return join(this.folder("action-runs"), runId);
  }

  /** An Action run's log, beside its checkout, kept with the run (spec §2.15, "Log"). */
  actionRunLog(runId: string): string {
    return join(this.folder("action-runs"), `${runId}.log`);
  }
}
