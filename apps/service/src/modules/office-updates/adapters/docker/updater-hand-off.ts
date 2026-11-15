import type { OfficeUpdateRequest } from "../../domain/office-update-request.js";
import { OfficeContainer } from "../../ports/office-container.js";
import { UpdateFolder } from "../../ports/update-folder.js";
import { UpdateHandOff, type HandedOff } from "../../ports/update-hand-off.js";

/**
 * A Docker Compose install's hand-off: the request in the update folder, then the Office updater,
 * which replaces the service's container while the service runs on.
 */
export class UpdaterHandOff extends UpdateHandOff {
  constructor(
    private readonly folder: UpdateFolder,
    private readonly container: OfficeContainer,
    private readonly officeDataDirectory: string,
  ) {
    super();
  }

  async handOff(request: OfficeUpdateRequest): Promise<HandedOff> {
    const updateFolder = this.folder.path;
    if (!updateFolder) throw new Error("The Office's container has no update folder.");
    await this.folder.writeRequest(request);
    const { ended } = await this.container.startUpdater({
      updateFolder,
      officeDataDirectory: this.officeDataDirectory,
    });
    return { serviceStops: false, ended };
  }
}
