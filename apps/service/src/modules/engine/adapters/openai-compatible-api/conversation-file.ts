import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { ChatMessage } from "./chat-completions.js";
import { isMissing } from "./file-problems.js";
import { parsedJson } from "./json-text.js";

/**
 * Inside a session's own folder of the Office data directory (`sessions/<session id>/`), which goes
 * with the session's skills folder once the session can't be resumed (spec §5.6).
 */
const FILE_NAME = "conversation.json";

/** Session ids name folders, so none may lead out of the sessions folder. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

/** A user message's part: its text, or an image the model sees, kept whole as a data URL. */
const userContentPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image_url"), image_url: z.object({ url: z.string() }) }),
]);

/** The system prompt is left out: a resumed session is given its options again and builds it anew. */
const keptMessageSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("user"),
    content: z.union([z.string(), z.array(userContentPartSchema)]),
  }),
  z.object({
    role: z.literal("assistant"),
    content: z.string().nullable(),
    tool_calls: z.array(toolCallSchema).optional(),
  }),
  z.object({ role: z.literal("tool"), tool_call_id: z.string(), content: z.string() }),
]);

const conversationSchema = z.object({ messages: z.array(keptMessageSchema) });

/** A session asked to resume with no conversation kept, or one that can't be read back. */
export class ConversationMissing extends Error {
  override readonly name = "ConversationMissing";

  constructor(
    readonly sessionId: string,
    reason: string,
  ) {
    super(`Session ${sessionId} can't be resumed: ${reason}`);
  }
}

/**
 * The conversation a session of the loop keeps, so it resumes by its id as the SDK's sessions do.
 * Each save writes the whole conversation to a file beside it and moves it into place, so a crash
 * leaves the last whole one.
 */
export class ConversationFile {
  private saving: Promise<void> = Promise.resolve();

  private constructor(
    private readonly sessionId: string,
    readonly path: string,
  ) {}

  /** The file of `sessionId` in the Office data directory's `sessions` folder. */
  static of(sessionsFolder: string, sessionId: string): ConversationFile {
    if (!SESSION_ID.test(sessionId)) {
      throw new Error(`"${sessionId}" can't name a session's folder.`);
    }
    return new ConversationFile(sessionId, join(sessionsFolder, sessionId, FILE_NAME));
  }

  /** Throws ConversationMissing when the session kept none, or what it kept doesn't read back. */
  async read(): Promise<ChatMessage[]> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if (isMissing(error))
        throw new ConversationMissing(this.sessionId, "it kept no conversation.");
      throw error;
    }
    const kept = conversationSchema.safeParse(parsedJson(text));
    if (!kept.success) {
      throw new ConversationMissing(
        this.sessionId,
        `its conversation doesn't read back (${this.path}).`,
      );
    }
    return kept.data.messages;
  }

  /**
   * Keeps `messages` as they are now; saves run one after another in the order asked. Resolves once
   * this one is written, and rejects when it couldn't be.
   */
  save(messages: readonly ChatMessage[]): Promise<void> {
    const text = JSON.stringify({ messages: messages.filter(({ role }) => role !== "system") });
    const saved = this.saving.then(() => this.write(text));
    this.saving = saved.catch(() => undefined);
    return saved;
  }

  private async write(text: string): Promise<void> {
    const writing = `${this.path}.writing`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(writing, text, "utf8");
    await rename(writing, this.path);
  }
}
