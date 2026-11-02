import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { PastedToken } from "../../domain/pasted-token.js";

/** Where the binary keeps a config folder's login on Windows and Linux. */
const CREDENTIALS_FILE = ".credentials.json";

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
 * Signs the engine's folder in by a pasted token (spec §5.4, §6): written as the folder's login, in
 * no environment, so the Office rules refuse it as they refuse the folder. Written beside and moved
 * into place, so a session starting meanwhile never reads half of it. Owner-only where the system
 * has file modes; on Windows it takes the data directory's access list.
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
  const written = join(configFolder, `.credentials-${randomUUID()}.json`);
  try {
    await writeFile(written, JSON.stringify(credentials), { flag: "wx", mode: 0o600 });
    await rename(written, join(configFolder, CREDENTIALS_FILE));
  } finally {
    await rm(written, { force: true });
  }
}

/** Signs the engine's folder out, whether a Sign in or a pasted token signed it in. */
export async function removeEngineCredentials(configFolder: string): Promise<void> {
  await rm(join(configFolder, CREDENTIALS_FILE), { force: true });
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

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
