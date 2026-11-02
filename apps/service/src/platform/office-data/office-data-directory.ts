import { join } from "node:path";

/** The folders of the Office data directory (docs/tasks/build-defaults.md). */
export type OfficeDataFolder =
  | "worktrees"
  | "bases"
  | "sessions"
  | "skills"
  | "attachments"
  | "identity"
  | "repositories"
  | "engines"
  | "test-output";

/** Where The Office keeps its files outside the database: OFFICE_DATA_DIR or the system's default. */
export class OfficeDataDirectory {
  constructor(readonly path: string) {}

  folder(name: OfficeDataFolder): string {
    return join(this.path, name);
  }
}
