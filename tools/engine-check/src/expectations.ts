import { readFile, writeFile } from "node:fs/promises";
import type { Observation, Platform } from "./check.ts";

/** The recorded result of each check per platform: what `npm run engine-check` compares against. */
export type Expectations = Record<string, Partial<Record<Platform, Observation>>>;

export async function loadExpectations(path: string): Promise<Expectations> {
  return JSON.parse(await readFile(path, "utf8")) as Expectations;
}

export async function saveExpectations(path: string, expectations: Expectations): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(expectations).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`);
}
