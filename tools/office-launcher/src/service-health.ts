// Whether a newly started service came up: its /api/health answers that the database is up.
import { setTimeout as delay } from "node:timers/promises";

/** How long a new version has to answer /api/health before the update is rolled back. */
export const HEALTH_TIMEOUT_MS = 5 * 60_000;

const ANY_ADDRESS = new Set(["0.0.0.0", "::"]);

/**
 * The service's /api/health, from the variables it listens with: OFFICE_HOST (127.0.0.1 when
 * unset, and loopback in place of an address meaning every interface) and OFFICE_PORT.
 */
export function healthUrlOf(environment: NodeJS.ProcessEnv): string {
  const configured = environment["OFFICE_HOST"]?.trim() || "127.0.0.1";
  const host = ANY_ADDRESS.has(configured) ? "127.0.0.1" : configured;
  const port = environment["OFFICE_PORT"]?.trim();
  if (!port) throw new Error("OFFICE_PORT isn't set, so the service's health can't be checked.");
  return `http://${host.includes(":") ? `[${host}]` : host}:${port}/api/health`;
}

export interface HealthWait {
  readonly timeoutMs: number;
  readonly intervalMs?: number;
}

export type HealthOutcome = "healthy" | "exited" | "timed out";

/** Polls `url` until it answers `{"database":"up"}`, the service exits, or the time is up. */
export async function waitUntilHealthy(
  url: string,
  exited: Promise<unknown>,
  { timeoutMs, intervalMs = 1000 }: HealthWait,
): Promise<HealthOutcome> {
  const ended = exited.then(
    () => "exited" as const,
    () => "exited" as const,
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const answer = await Promise.race([answersHealthy(url, deadline - Date.now()), ended]);
    if (answer === "exited") return "exited";
    if (answer) return "healthy";
    const waited = await Promise.race([
      delay(intervalMs, "waited" as const, { ref: false }),
      ended,
    ]);
    if (waited === "exited") return "exited";
  }
  return "timed out";
}

async function answersHealthy(url: string, remainingMs: number): Promise<boolean> {
  try {
    const signal = AbortSignal.timeout(Math.max(1, Math.min(5000, remainingMs)));
    const response = await fetch(url, { signal });
    if (!response.ok) return false;
    const body = (await response.json()) as { database?: unknown };
    return body.database === "up";
  } catch {
    return false;
  }
}
