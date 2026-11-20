import type { CommitMessage } from "./publication.js";

/**
 * The commit message with a `Fixes #n` line for each issue, in its whole and in its body (the pull
 * request's), so the code host closes the issue once the change reaches its default branch. An
 * issue either already names with a closing keyword gets no second line there.
 */
export function withFixes(message: CommitMessage, numbers: readonly number[]): CommitMessage {
  const wanted = [...new Set(numbers)].toSorted((one, other) => one - other);
  const whole = withLines(message.whole, wanted);
  const body = withLines(message.body, wanted);
  return whole === message.whole && body === message.body
    ? message
    : { subject: message.subject, body, whole };
}

function withLines(text: string, numbers: readonly number[]): string {
  const missing = numbers.filter((number) => !closes(text, number));
  if (missing.length === 0) return text;
  const lines = missing.map((number) => `Fixes #${number}`).join("\n");
  const kept = text.trimEnd();
  return kept === "" ? lines : `${kept}\n\n${lines}`;
}

/** Whether the text closes issue `number` already, by any of GitHub's closing keywords. */
function closes(text: string, number: number): boolean {
  return new RegExp(
    `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s*:?\\s+#${number}(?!\\d)`,
    "i",
  ).test(text);
}
