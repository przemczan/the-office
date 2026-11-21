import type { AdbKey } from "../domain/adb-key.js";
import { AdbKeyRepository } from "./adb-key-repository.js";

/** Each Project's adb key in memory. */
export class AdbKeysForTests extends AdbKeyRepository {
  readonly keys = new Map<string, AdbKey>();

  find(projectId: string): Promise<AdbKey | undefined> {
    return Promise.resolve(this.keys.get(projectId));
  }

  keepFirst(key: AdbKey): Promise<AdbKey> {
    const kept = this.keys.get(key.projectId) ?? key;
    this.keys.set(key.projectId, kept);
    return Promise.resolve(kept);
  }
}
