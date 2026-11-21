import type { AdbKey } from "../domain/adb-key.js";

/** What the Office device helper's `adb-key` mode reads on its standard input. */
export abstract class AdbKeyInput {
  abstract of(key: AdbKey): readonly Uint8Array[];
}
