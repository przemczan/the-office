import { RestartHandOff } from "../../ports/restart-hand-off.js";
import { UpdateFolder } from "../../ports/update-folder.js";

/** The launcher's restart: a restart request in its folder, which it reads once the service exits. */
export class LauncherRestart extends RestartHandOff {
  constructor(private readonly folder: UpdateFolder) {
    super();
  }

  async handOff(): Promise<void> {
    await this.folder.writeRequest({ kind: "restart" });
  }
}
