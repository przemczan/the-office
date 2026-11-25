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
    const { onEnvironment } = start;
    try {
      return await this.environments.run({
        ...start,
        // The hook's refusal ends the run in its words, as Run environments takes it.
        ...(onEnvironment === undefined
          ? {}
          : {
              onEnvironment: async (environment) => {
                try {
                  return await onEnvironment(environment);
                } catch (error) {
                  if (error instanceof ActionRunRefused) {
                    throw new RunEnvironmentRefused(error.reasons);
                  }
                  throw error;
                }
              },
            }),
      });
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
