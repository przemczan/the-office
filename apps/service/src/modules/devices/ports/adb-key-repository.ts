import type { AdbKey } from "../domain/adb-key.js";

/** Where each Project's adb key is kept, as its Secret variables are: in the database alone. */
export abstract class AdbKeyRepository {
  abstract find(projectId: string): Promise<AdbKey | undefined>;

  /** Keeps the key unless the Project has one already, and answers the one kept. */
  abstract keepFirst(key: AdbKey): Promise<AdbKey>;
}
