import { Injectable } from "@nestjs/common";
import type { SignedInUser } from "../../../platform/http/signed-in-requests.js";

/**
 * Set up run environment for a Project: On at once with a valid definition, else its set-up Task,
 * added as `by` asked.
 */
export type RunEnvironmentSetUp = (projectId: string, by: SignedInUser) => Promise<void>;

/**
 * Set up run environment, given by Run environments as it starts, for a Project added with the
 * answer Yes: Run environments reads the Project's setting through Projects, so Projects can't ask
 * it directly (the module template's registry).
 */
@Injectable()
export class RunEnvironmentSetUpRegistry {
  private registered: RunEnvironmentSetUp | undefined;

  register(setUp: RunEnvironmentSetUp): void {
    this.registered = setUp;
  }

  async setUp(projectId: string, by: SignedInUser): Promise<void> {
    if (!this.registered) throw new Error("No Set up run environment is registered.");
    await this.registered(projectId, by);
  }
}
