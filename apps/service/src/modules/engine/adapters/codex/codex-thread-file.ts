import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { isMissing } from "../skills/file-problems.js";
import { parsedJson } from "../skills/json-text.js";

/**
 * Inside a session's own folder of the Office data directory (`sessions/<session id>/`), which goes
 * with the session's skills folder once the session can't be resumed (spec §5.6).
 */
const FILE_NAME = "codex-thread.json";

/** Session ids name folders, so none may lead out of the sessions folder. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const keptThreadSchema = z.object({ threadId: z.string().min(1) });

/** A Codex session asked to resume with no thread kept, or one that can't be read back. */
export class CodexThreadMissing extends Error {
  override readonly name = "CodexThreadMissing";

  constructor(
    readonly sessionId: string,
    reason: string,
  ) {
    super(`Session ${sessionId} can't be resumed: ${reason}`);
  }
}

/**
 * The Codex thread a session runs on, kept so the session resumes by its own id: Codex keeps the
 * thread's history in the engine's folder, under an id of its own. Written beside and moved into
 * place, so a crash leaves the whole file or none.
 */
export class CodexThreadFile {
  private constructor(
    private readonly sessionId: string,
    readonly path: string,
  ) {}

  /** The file of `sessionId` in the Office data directory's `sessions` folder. */
  static of(sessionsFolder: string, sessionId: string): CodexThreadFile {
    if (!SESSION_ID.test(sessionId)) {
      throw new Error(`"${sessionId}" can't name a session's folder.`);
    }
    return new CodexThreadFile(sessionId, join(sessionsFolder, sessionId, FILE_NAME));
  }

  /** Throws CodexThreadMissing when the session kept no thread, or what it kept doesn't read. */
  async read(): Promise<string> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if (isMissing(error)) throw new CodexThreadMissing(this.sessionId, "it kept no thread.");
      throw error;
    }
    const kept = keptThreadSchema.safeParse(parsedJson(text));
    if (!kept.success) {
      throw new CodexThreadMissing(this.sessionId, `its thread doesn't read back (${this.path}).`);
    }
    return kept.data.threadId;
  }

  async write(threadId: string): Promise<void> {
    const writing = `${this.path}.writing`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(writing, JSON.stringify({ threadId }), "utf8");
    await rename(writing, this.path);
  }
}
