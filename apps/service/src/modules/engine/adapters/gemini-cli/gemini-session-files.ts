import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** What one opening of a session writes for the CLI and its relays. */
export interface GeminiSessionFileContents {
  /** The session's settings (`geminiSettings`). */
  readonly settings: Record<string, unknown>;
  /** Where the relays reach the service and with which token (`ChannelPlace`). */
  readonly channel: Readonly<Record<string, string>>;
  /** The Agent's instructions, which the CLI reads from the home's `.gemini/`; none when empty. */
  readonly instructions: string;
}

/**
 * The files one opening of a Gemini CLI session needs, written before its first turn and removed as
 * it ends; each start and resume writes its own, so ending a session never removes what its resume
 * has just written. The settings and the channel file, which holds the session's token, are
 * owner-only in the session's folder of the Office data directory, which the Office rules refuse, as
 * a Claude Code session's MCP config is (`McpConfigFile`); the instructions file is in the engine's
 * home, where the CLI reads it as its global memory.
 */
export class GeminiSessionFiles {
  private constructor(
    readonly settingsFile: string,
    readonly channelFile: string,
    /** By its name in the home's `.gemini/`, as the settings name it; undefined without one. */
    readonly instructionsFileName: string | undefined,
    private readonly instructionsFile: string | undefined,
  ) {}

  /** Names the files; `write` writes them once the settings can name the channel file. */
  static named(sessionsFolder: string, sessionId: string, home: string, instructions: string) {
    const opening = randomUUID();
    const folder = join(sessionsFolder, sessionId);
    const instructionsFileName =
      instructions === "" ? undefined : `office-instructions-${sessionId}-${opening}.md`;
    return new GeminiSessionFiles(
      join(folder, `gemini-settings-${opening}.json`),
      join(folder, `gemini-channel-${opening}.json`),
      instructionsFileName,
      instructionsFileName === undefined ? undefined : join(home, ".gemini", instructionsFileName),
    );
  }

  async write({ settings, channel, instructions }: GeminiSessionFileContents): Promise<void> {
    await mkdir(join(this.settingsFile, ".."), { recursive: true, mode: 0o700 });
    await writeFile(this.channelFile, JSON.stringify(channel), { flag: "wx", mode: 0o600 });
    await writeFile(this.settingsFile, JSON.stringify(settings, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
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
