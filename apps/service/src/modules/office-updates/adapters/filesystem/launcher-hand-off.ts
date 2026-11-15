import type { OfficeUpdateRequest } from "../../domain/office-update-request.js";
import { UpdateFolder } from "../../ports/update-folder.js";
import { UpdateHandOff, type HandedOff } from "../../ports/update-hand-off.js";

/** The launcher's hand-off: the request in its folder, then the service stops for it. */
export class LauncherHandOff extends UpdateHandOff {
  constructor(private readonly folder: UpdateFolder) {
    super();
  }

  async handOff(request: OfficeUpdateRequest): Promise<HandedOff> {
    await this.folder.writeRequest(request);
    return { serviceStops: true };
  }
}
