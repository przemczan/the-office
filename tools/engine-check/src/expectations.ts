import { readFile, writeFile } from "node:fs/promises";
import type { Observation, Platform } from "./check.ts";

/** The recorded result of each check per platform: what `npm run engine-check` compares against. */
export type Expectations = Record<string, Partial<Record<Platform, Observation>>>;

export async function loadExpectations(path: string): Promise<Expectations> {
  return JSON.parse(await readFile(path, "utf8")) as Expectations;
}

/**
 * Writes `observations` for `platform` over the file as it is now, not as it was when the run began,
 * so a long run recording at its end keeps what another run recorded meanwhile.
 */
export async function recordObservations(path: string, platform: Platform, observations: Readonly<Record<string, Observation>>): Promise<void> {
  const expectations = await loadExpectations(path);
  for (const [id, observation] of Object.entries(observations)) {
    expectations[id] = { ...expectations[id], [platform]: observation };
  }
  await saveExpectations(path, expectations);
}

async function saveExpectations(path: string, expectations: Expectations): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(expectations).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`);
}
