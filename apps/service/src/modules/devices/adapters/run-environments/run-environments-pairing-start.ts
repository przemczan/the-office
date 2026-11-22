import { Injectable } from "@nestjs/common";
import { PairingEnvironments, RunEnvironmentRefused } from "../../../run-environments/index.js";
import {
  PairingEnvironmentStart,
  type PairingEnvironmentToStart,
  type RunningPairingEnvironment,
} from "../../ports/pairing-environment-start.js";

/** Run environments starts a pairing environment, from the definition Projects wrote out. */
@Injectable()
export class RunEnvironmentsPairingStart extends PairingEnvironmentStart {
  constructor(private readonly pairingEnvironments: PairingEnvironments) {
    super();
  }

  async start(
    start: PairingEnvironmentToStart,
  ): Promise<RunningPairingEnvironment | { readonly problems: readonly string[] }> {
    try {
      const environment = await this.pairingEnvironments.start({
        projectId: start.projectId,
        deviceId: start.projectDeviceId,
        definitionFolder: start.definitionFolder,
        logFile: start.logFile,
      });
      return {
        // A removed environment refuses to attach: adb's step finds it not running.
        attach: (attachment) =>
          environment.attach(attachment).catch((error: unknown) => {
            if (error instanceof RunEnvironmentRefused) return undefined;
            throw error;
          }),
        remove: () => environment.remove(),
      };
    } catch (error) {
      if (error instanceof RunEnvironmentRefused) return { problems: error.reasons };
      throw error;
    }
  }

  sweep(): Promise<void> {
    return this.pairingEnvironments.sweep();
  }
}
