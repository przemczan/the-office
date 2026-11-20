import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** What one opening of a session writes for the CLI and its relays. */
export interface SessionFileContents {
  readonly settings: Record<string, unknown>;
  /** Where the relays reach the channel and with which token. */
  readonly channel: { readonly address: string; readonly token: string };
  /** The Agent's instructions; none when empty. */
  readonly instructions: string;
}

/**
 * The files one opening of a session needs, laid out as the adapter's `gemini-session-files.ts` (the
 * source of truth) lays them out: the settings and the channel file owner-only in the session's
 * folder of the Office data directory, the instructions file in the engine folder's `.gemini/`.
 */
export class SessionFiles {
  readonly settingsFile: string;
  readonly channelFile: string;
  readonly instructionsFileName: string | undefined;
  private readonly instructionsFile: string | undefined;

  private constructor(
    settingsFile: string,
    channelFile: string,
    instructionsFileName: string | undefined,
    instructionsFile: string | undefined,
  ) {
    this.settingsFile = settingsFile;
    this.channelFile = channelFile;
    this.instructionsFileName = instructionsFileName;
    this.instructionsFile = instructionsFile;
  }

  static named(
    sessionsFolder: string,
    sessionId: string,
    home: string,
    instructions: string,
  ): SessionFiles {
    const opening = randomUUID();
    const folder = join(sessionsFolder, sessionId);
    const instructionsFileName =
      instructions === "" ? undefined : `office-instructions-${sessionId}-${opening}.md`;
    return new SessionFiles(
      join(home, ".gemini", "settings.json"),
      join(folder, `gemini-channel-${opening}.json`),
      instructionsFileName,
      instructionsFileName === undefined ? undefined : join(home, ".gemini", instructionsFileName),
    );
  }

  get sessionFolder(): string {
    return join(this.channelFile, "..");
  }

  async write({ settings, channel, instructions }: SessionFileContents): Promise<void> {
    await mkdir(this.sessionFolder, { recursive: true, mode: 0o700 });
    await writeFile(this.channelFile, JSON.stringify(channel), { flag: "wx", mode: 0o600 });
    await mkdir(join(this.settingsFile, ".."), { recursive: true, mode: 0o700 });
    await writeFile(this.settingsFile, JSON.stringify(settings, null, 2), { mode: 0o600 });
    if (this.instructionsFile !== undefined) {
      await mkdir(join(this.instructionsFile, ".."), { recursive: true });
      await writeFile(this.instructionsFile, instructions, { flag: "wx", mode: 0o600 });
    }
  }

  async remove(): Promise<void> {
    await Promise.all(
      [this.settingsFile, this.channelFile, this.instructionsFile].map((file) =>
        file === undefined ? undefined : rm(file, { force: true }),
      ),
    );
  }
}
