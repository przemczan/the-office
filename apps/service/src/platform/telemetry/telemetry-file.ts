import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { telemetryChoiceSchema, type TelemetryChoice } from "@the-office/contracts";
import { currentOperatingSystem } from "../os/current-operating-system.js";

/** The telemetry setting's file, in the Office data directory itself. */
export const TELEMETRY_FILE = "telemetry.json";

export function telemetryFilePath(officeDataDirectory: string): string {
  return join(officeDataDirectory, TELEMETRY_FILE);
}

/** The saved choice, or why there is none: no file, or one The Office can't read as a setting. */
export type TelemetryFileReading =
  { readonly choice: TelemetryChoice } | { readonly choice: undefined; readonly problem?: string };

/**
 * Reads the saved choice. A missing file is no choice; so is one that can't be read or isn't a
 * setting, with a problem that names no value from it, as it can hold credentials.
 */
export async function readTelemetryFile(path: string): Promise<TelemetryFileReading> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { choice: undefined };
    return { choice: undefined, problem: `${path} could not be read (${code ?? "unknown error"})` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { choice: undefined, problem: `${path} is not JSON` };
  }
  const choice = telemetryChoiceSchema.safeParse(parsed);
  return choice.success
    ? { choice: choice.data }
    : { choice: undefined, problem: `${path} is not a telemetry setting` };
}

/**
 * Saves the choice, readable and writable by the user The Office runs as only, since its headers
 * can hold credentials. Written beside and renamed over it, so a start never reads half of it.
 */
export async function writeTelemetryFile(path: string, choice: TelemetryChoice): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const written = `${path}.${randomUUID()}`;
  try {
    await writeFile(written, `${JSON.stringify(choice, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await currentOperatingSystem().restrictToOwner(written, "file");
    await rename(written, path);
  } finally {
    await rm(written, { force: true });
  }
}
