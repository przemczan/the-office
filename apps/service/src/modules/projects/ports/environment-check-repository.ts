import type { EnvironmentCheck } from "../domain/environment-check.js";

/** Where each Project's last finished environment check is kept. */
export abstract class EnvironmentCheckRepository {
  /** Keeps the check in place of the Project's last one. */
  abstract save(check: EnvironmentCheck): Promise<void>;

  abstract find(projectId: string): Promise<EnvironmentCheck | undefined>;
}
