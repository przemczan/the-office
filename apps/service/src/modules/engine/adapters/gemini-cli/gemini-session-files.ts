import { randomUUID } from "node:crypto";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
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
 * The session's own CLI home (`GEMINI_CLI_HOME`), `<engine folder>/sessions/<session id>/`, made
 * owner-only when missing: it keeps the session's chat, so a resume runs in the same folder, and its
 * `.gemini/settings.json`, the CLI's user settings, holds the session's settings. Not a system
 * settings file (`GEMINI_CLI_SYSTEM_SETTINGS_PATH`): the pinned CLI reads that only when it and every
 * folder above it are root-owned (Windows: administrators- or SYSTEM-owned) and not writable by group
 * or others, else skips it, so folder trust comes back on and every headless turn is refused; the
 * user settings have no such rule, as the engine check's `gemini.start` ran them.
 */
export async function preparedGeminiSessionHome(
  engineFolder: string,
  sessionId: string,
): Promise<string> {
  const home = join(engineFolder, "sessions", sessionId);
  await mkdir(home, { recursive: true, mode: 0o700 });
  return home;
}

/**
 * The files one opening of a Gemini CLI session needs, written before its first turn. The settings
 * are the session home's `.gemini/settings.json` (`preparedGeminiSessionHome`), owner-only and
 * written over at each start and resume. The channel file, which holds the session's token, is
 * owner-only in the session's folder of the Office data directory, which the Office rules refuse, as
 * a Claude Code session's MCP config is (`McpConfigFile`); the instructions file is in the home's
 * `.gemini/`, where the CLI reads it as its global memory. Those two are each opening's own and
 * removed as it ends, so ending a session never removes what its resume has just written; the
 * settings stay with the home and its chat, which the next opening rewrites.
 */
export class GeminiSessionFiles {
  private constructor(
    readonly settingsFile: string,
    readonly channelFile: string,
    /** By its name in the home's `.gemini/`, as the settings name it; undefined without one. */
    readonly instructionsFileName: string | undefined,
    private readonly instructionsFile: string | undefined,
  ) {}

  /**
   * Names the files, the settings in the session's `home`; `write` writes them once the settings
   * can name the channel file.
   */
  static named(sessionsFolder: string, sessionId: string, home: string, instructions: string) {
    const opening = randomUUID();
    const instructionsFileName =
      instructions === "" ? undefined : `office-instructions-${sessionId}-${opening}.md`;
    return new GeminiSessionFiles(
      join(home, ".gemini", "settings.json"),
      join(sessionsFolder, sessionId, `gemini-channel-${opening}.json`),
      instructionsFileName,
      instructionsFileName === undefined ? undefined : join(home, ".gemini", instructionsFileName),
    );
  }

  async write({ settings, channel, instructions }: GeminiSessionFileContents): Promise<void> {
    await mkdir(join(this.channelFile, ".."), { recursive: true, mode: 0o700 });
    await writeFile(this.channelFile, JSON.stringify(channel), { flag: "wx", mode: 0o600 });
    await mkdir(join(this.settingsFile, ".."), { recursive: true, mode: 0o700 });
    await writeFile(this.settingsFile, JSON.stringify(settings, null, 2), { mode: 0o600 });
    // A file an earlier opening wrote keeps its mode when written over; it stays owner-only.
    await chmod(this.settingsFile, 0o600);
    if (this.instructionsFile !== undefined) {
      await writeFile(this.instructionsFile, instructions, { flag: "wx", mode: 0o600 });
    }
  }

  /** The channel file and the instructions file; the home, its chat and its settings stay. */
  async remove(): Promise<void> {
    await Promise.all(
      [this.channelFile, this.instructionsFile].map((file) =>
        file === undefined ? undefined : rm(file, { force: true }),
      ),
    );
  }
}
