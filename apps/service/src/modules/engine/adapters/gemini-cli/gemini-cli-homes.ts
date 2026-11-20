import type { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import type { EngineId } from "../../domain/engines.js";
import { GeminiCliHomes } from "../../ports/gemini-cli-homes.js";
import {
  preparedEngineConfigFolder,
  removeEngineConfigFolder,
} from "../engine-folders/engine-config-folder.js";

/** Each Gemini CLI engine's home is its own folder, `<office-data>/engines/<engine id>/`. */
export class GeminiCliEngineFolders extends GeminiCliHomes {
  constructor(private readonly officeData: OfficeDataDirectory) {
    super();
  }

  async prepareHome(engineId: EngineId): Promise<void> {
    await preparedEngineConfigFolder(this.officeData, engineId);
  }

  removeHome(engineId: EngineId): Promise<void> {
    return removeEngineConfigFolder(this.officeData, engineId);
  }
}
