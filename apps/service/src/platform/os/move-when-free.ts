import { rename } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

/** Windows' codes for a path another process holds open for a moment, such as a virus scanner. */
const BUSY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const ATTEMPTS = 5;
const RETRY_DELAY_MS = 200;

/**
 * Renames `from` to `to`, trying again for about two seconds while the path is busy: Windows refuses
 * to rename a folder while anything holds a file in it open, as a scanner does with files just written.
 */
export async function moveWhenFree(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const busy = BUSY_CODES.has((error as NodeJS.ErrnoException).code ?? "");
      if (!busy || attempt === ATTEMPTS) throw error;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
}
