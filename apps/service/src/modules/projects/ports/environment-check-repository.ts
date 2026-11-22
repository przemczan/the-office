import type { EnvironmentCheck } from "../domain/environment-check.js";

/** Where each Project's last finished environment check is kept. */
export abstract class EnvironmentCheckRepository {
  /** Keeps the check in place of the Project's last one. */
  abstract save(check: EnvironmentCheck): Promise<void>;

  /** Each Project's last finished check, every Project at once. */
  abstract listAll(): Promise<readonly EnvironmentCheck[]>;

  abstract find(projectId: string): Promise<EnvironmentCheck | undefined>;
}
