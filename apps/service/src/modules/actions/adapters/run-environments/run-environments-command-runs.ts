import { Injectable } from "@nestjs/common";
import { ActionRunEnvironments, RunEnvironmentRefused } from "../../../run-environments/index.js";
import { ActionRunRefused } from "../../domain/action-run-refused.js";
import {
  CommandRunEnvironments,
  type RunInEnvironment,
  type RunInEnvironmentEnd,
} from "../../ports/command-run-environments.js";

/** Run environments' `ActionRunEnvironments`: a command run's own compose project. */
@Injectable()
export class RunEnvironmentsCommandRuns extends CommandRunEnvironments {
  constructor(private readonly environments: ActionRunEnvironments) {
    super();
  }

  async run(start: RunInEnvironment): Promise<RunInEnvironmentEnd> {
    try {
      return await this.environments.run(start);
    } catch (error) {
      if (error instanceof RunEnvironmentRefused) throw new ActionRunRefused(error.reasons);
      throw error;
    }
  }

  stop(runId: string): Promise<void> {
    return this.environments.stop(runId);
  }

  sweep(): Promise<void> {
    return this.environments.sweep();
  }
}
