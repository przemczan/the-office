import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** One line of an engine transcript; only the fields the checks read are typed. */
export interface TranscriptEntry {
  readonly type: string;
  readonly attachment?: {
    readonly type: string;
    readonly content?: unknown;
    readonly addedNames?: unknown;
  };
}

/** Where the engine keeps the transcripts of sessions run in a working directory. */
export function transcriptFolder(workingDirectory: string): string {
  return join(homedir(), ".claude", "projects", workingDirectory.replace(/[^a-zA-Z0-9]/g, "-"));
}

export async function readTranscript(
  workingDirectory: string,
  sessionId: string,
): Promise<TranscriptEntry[]> {
  const text = await readFile(
    join(transcriptFolder(workingDirectory), `${sessionId}.jsonl`),
    "utf8",
  );
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
  return entries.flatMap(({ attachment }) =>
    attachment?.type === "skill_listing" && typeof attachment.content === "string"
      ? [listedNames(attachment.content)]
      : [],
  );
}

/**
 * The tools the engine first announced to the model as deferred, to be loaded with `ToolSearch`:
 * its first `deferred_tools_delta` attachment, empty when it deferred none. The `init` message's
 * `tools` names deferred tools too, so only this tells them from the ones loaded from the start.
 */
export function deferredAtStart(entries: readonly TranscriptEntry[]): string[] {
  const added = entries.find(({ attachment }) => attachment?.type === "deferred_tools_delta")
    ?.attachment?.addedNames;
  return Array.isArray(added)
    ? added.filter((name): name is string => typeof name === "string")
    : [];
}

function listedNames(listing: string): string[] {
  return listing
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).split(": ")[0] as string);
}
