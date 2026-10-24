import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** One line of an engine transcript; only the fields the checks read are typed. */
export interface TranscriptEntry {
  readonly type: string;
  readonly attachment?: { readonly type: string; readonly content?: unknown };
}

/** Where the engine keeps the transcripts of sessions run in a working directory. */
export function transcriptFolder(workingDirectory: string): string {
  return join(homedir(), ".claude", "projects", workingDirectory.replace(/[^a-zA-Z0-9]/g, "-"));
}

export async function readTranscript(workingDirectory: string, sessionId: string): Promise<TranscriptEntry[]> {
  const text = await readFile(join(transcriptFolder(workingDirectory), `${sessionId}.jsonl`), "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as TranscriptEntry);
}

/**
 * The skill names in each skill listing the engine attached for the model, in transcript order.
 * A listing renders one `- <name>: <description>` line per skill.
 */
export function skillListings(entries: readonly TranscriptEntry[]): string[][] {
  return entries
    .filter((entry) => entry.attachment?.type === "skill_listing" && typeof entry.attachment.content === "string")
    .map((entry) =>
      (entry.attachment?.content as string)
        .split("\n")
        .filter((line) => line.startsWith("- "))
        .map((line) => line.slice(2).split(": ")[0] as string),
    );
}
