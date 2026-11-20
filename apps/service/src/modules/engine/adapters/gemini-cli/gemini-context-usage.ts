import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * How many tokens the context of every model a Gemini CLI engine offers takes: each alias of
 * `GEMINI_CLI_MODELS` resolves to a Gemini model with a context of 1,048,576 tokens.
 */
export const GEMINI_CLI_CONTEXT_WINDOW = 1_048_576;

/** A model answer's tokens as the CLI's chat record keeps them (its `recordMessageTokens`). */
interface RecordedTokens {
  readonly input?: number;
  readonly output?: number;
}

/**
 * What the session's context holds after the model's latest answer, read from the chat the CLI keeps
 * under its home (`.gemini/tmp/<project>/chats/session-<time>-<first 8 of the id>.jsonl`, one record
 * a line, a later record of a message replacing an earlier one): that answer's prompt and output
 * tokens. Undefined when no chat of the session records any, as before its first answer.
 *
 * A turn's `result` only sums its requests' prompts, so it can't tell the context's size; the chat
 * record is the pinned CLI's own file, read from its code, not by the engine check.
 */
export async function recordedContextTokens(
  home: string,
  sessionId: string,
): Promise<number | undefined> {
  const tmp = join(home, ".gemini", "tmp");
  const projects = await readdir(tmp).catch(() => []);
  for (const project of projects) {
    const chats = join(tmp, project, "chats");
    const files = await readdir(chats).catch(() => []);
    for (const file of files.filter((name) => isChatOf(name, sessionId))) {
      const tokens = latestAnswerTokens(await readFile(join(chats, file), "utf8"), sessionId);
      if (tokens !== undefined) return tokens;
    }
  }
  return undefined;
}

function isChatOf(fileName: string, sessionId: string): boolean {
  return fileName.startsWith("session-") && fileName.endsWith(`-${sessionId.slice(0, 8)}.jsonl`);
}

/** The latest model answer's tokens, when the chat is the session's (its first line names it). */
function latestAnswerTokens(chat: string, sessionId: string): number | undefined {
  const records = chat.split("\n").flatMap((line) => parsedRecord(line));
  if (records[0]?.["sessionId"] !== sessionId) return undefined;
  const answer = records.findLast(
    (record) => record["type"] === "gemini" && typeof record["tokens"] === "object",
  );
  const tokens = answer?.["tokens"] as RecordedTokens | undefined;
  return tokens === undefined ? undefined : (tokens.input ?? 0) + (tokens.output ?? 0);
}

function parsedRecord(line: string): Record<string, unknown>[] {
  if (line.trim() === "") return [];
  try {
    const parsed = JSON.parse(line) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? [parsed as Record<string, unknown>]
      : [];
  } catch {
    return [];
  }
}
