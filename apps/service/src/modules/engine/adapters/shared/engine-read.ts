import { ENGINE_READ_TIMEOUT_MS, EngineReadTimedOut } from "../../ports/agent-engine.js";

/** How long a read's engine has to end by itself once closed: it runs no turn to finish. */
export const READ_EXIT_GRACE_MS = 2_000;

/**
 * The service's own variables, which an engine-level read's process starts from, as an account's
 * commands do; each adapter drops what its sessions drop.
 */
export function serviceVariables(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

/** How one engine-level read runs: what it is, in words, and what may end it early. */
export interface EngineReadLimits {
  /** What is read, as `EngineReadTimedOut` names it, such as "Reading the usage windows". */
  readonly what: string;
  /** Ends the read sooner, as the service stops; the read throws its reason. */
  readonly signal: AbortSignal;
  /** How long the read may take; `ENGINE_READ_TIMEOUT_MS` unless a test gives less. */
  readonly timeoutMs?: number | undefined;
}

/**
 * Runs an engine-level read, such as `readUsageWindows`, on what was opened for it, then always
 * ends that before answering: on its answer, its failure, its timeout (`EngineReadTimedOut`) and
 * `signal`'s abort (its reason) alike. Shared by every adapter whose read opens a process or query.
 */
export async function engineRead<T>(
  { what, signal, timeoutMs = ENGINE_READ_TIMEOUT_MS }: EngineReadLimits,
  read: () => Promise<T>,
  end: () => Promise<void>,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let aborted: (() => void) | undefined;
  try {
    signal.throwIfAborted();
    const stopped = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new EngineReadTimedOut(what)), timeoutMs);
      aborted = () => reject(signal.reason);
      signal.addEventListener("abort", aborted, { once: true });
    });
    const reading = read();
    // Once stopped, the read's own failure, as its process ends, is no one's to hear.
    reading.catch(() => undefined);
    return await Promise.race([reading, stopped]);
  } finally {
    clearTimeout(timer);
    if (aborted !== undefined) signal.removeEventListener("abort", aborted);
    await end();
  }
}
