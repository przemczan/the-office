import { randomUUID } from "node:crypto";
import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { OperatingSystem } from "../../../../platform/os/operating-system.js";
import type { AnthropicApiKey } from "../../domain/anthropic-api-key.js";
import type { PastedToken } from "../../domain/pasted-token.js";

/** Where the binary keeps a config folder's login on Windows and Linux. */
const CREDENTIALS_FILE = ".credentials.json";

/*
 * Where The Office keeps an engine's Anthropic API key, which the binary reads through the session
 * settings' `apiKeyHelper` (`apiKeyHelperOf`). Beside the login, outside `projects/`, the only part
 * of an engine's folder a session may read.
 */
const API_KEY_FILE = ".anthropic-api-key";

/** A `claude setup-token` token lasts a year from when it was made, about when it is pasted. */
const PASTED_TOKEN_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

/*
 * A Sign in's login carries a refresh token; only a pasted token's, which The Office writes, has
 * none. The binary reads `accessToken` alone as signed out, so the expiry and scopes are written
 * too (probed on 2.1.310, task 47 step 1e4).
 */
const pastedTokenCredentialsSchema = z.object({
  claudeAiOauth: z.object({ accessToken: z.string(), refreshToken: z.null() }),
});

/**
 * Signs the engine's folder in by a pasted token (spec §5.4, §6), in place of any API key: written
 * as the folder's login, in no environment, so the Office rules refuse it as they refuse the folder.
 */
export async function writePastedToken(
  configFolder: string,
  token: PastedToken,
  now: Date,
): Promise<void> {
  const credentials = {
    claudeAiOauth: {
      accessToken: token.reveal(),
      refreshToken: null,
      expiresAt: now.getTime() + PASTED_TOKEN_LIFETIME_MS,
      scopes: ["user:inference"],
    },
  };
  await writeOwnerOnly(configFolder, CREDENTIALS_FILE, JSON.stringify(credentials));
  await removeApiKey(configFolder);
}

/**
 * Signs the engine's folder in by an Anthropic API key (spec §5.4, §6), in place of any login it
 * held: written to a file of its own, in no environment and on no command line, as a pasted token
 * is written.
 */
export async function writeApiKey(configFolder: string, key: AnthropicApiKey): Promise<void> {
  await writeOwnerOnly(configFolder, API_KEY_FILE, key.reveal());
  await rm(join(configFolder, CREDENTIALS_FILE), { force: true });
}

/** Signs the engine's folder out, whether a Sign in, a pasted token or an API key signed it in. */
export async function removeEngineCredentials(configFolder: string): Promise<void> {
  await rm(join(configFolder, CREDENTIALS_FILE), { force: true });
  await removeApiKey(configFolder);
}

/** Removes the folder's API key, once a Sign in has signed it in in its place. */
export async function removeApiKey(configFolder: string): Promise<void> {
  await rm(join(configFolder, API_KEY_FILE), { force: true });
}

/** The folder's API key file, when an API key signs it in. */
export async function apiKeyFileOf(configFolder: string): Promise<string | undefined> {
  const file = join(configFolder, API_KEY_FILE);
  return (await exists(file)) ? file : undefined;
}

/**
 * The session settings' `apiKeyHelper` of an engine whose folder an API key signs in: a command
 * that prints the key file, as the settings go on the `-p` fallback's command line, which every
 * process of the user can read. None for any other folder, which the binary signs in by its login.
 */
export async function apiKeyHelperOf(
  configFolder: string,
  { printFileCommand }: Pick<OperatingSystem, "printFileCommand">,
): Promise<string | undefined> {
  const file = await apiKeyFileOf(configFolder);
  return file === undefined ? undefined : printFileCommand(file);
}

/** Whether the folder holds a login: a Sign in's or a pasted token. */
export function holdsLogin(configFolder: string): Promise<boolean> {
  return exists(join(configFolder, CREDENTIALS_FILE));
}

/** Whether the folder's login is a pasted token rather than a Sign in's. */
export async function holdsPastedToken(configFolder: string): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(join(configFolder, CREDENTIALS_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  return pastedTokenCredentialsSchema.safeParse(parsedJson(text)).success;
}

/**
 * Written beside and moved into place, so a session starting meanwhile never reads half of it.
 * Owner-only where the system has file modes; on Windows it takes the data directory's access list.
 */
async function writeOwnerOnly(configFolder: string, name: string, text: string): Promise<void> {
  const written = join(configFolder, `${name}-${randomUUID()}`);
  try {
    await writeFile(written, text, { flag: "wx", mode: 0o600 });
    await rename(written, join(configFolder, name));
  } finally {
    await rm(written, { force: true });
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
