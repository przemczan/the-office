import { containerRestartRefusal } from "../../domain/restart-refusal.js";
import { OfficeContainer } from "../../ports/office-container.js";
import { RestartHandOff } from "../../ports/restart-hand-off.js";

/**
 * A container's restart: Docker's restart policy starts it again once the service exits. The policy
 * is read again here, as `docker update --restart` may have changed it while the restart waited.
 */
export class ContainerRestart extends RestartHandOff {
  constructor(private readonly container: OfficeContainer) {
    super();
  }

  async handOff(): Promise<void> {
    const refusal = containerRestartRefusal(await this.container.read());
    if (refusal) throw new Error(refusal);
  }
}
