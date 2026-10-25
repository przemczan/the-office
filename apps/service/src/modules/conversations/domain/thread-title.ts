/** As long as a title taken from a message may be; the click-through's (prototypes/app/conversation.js). */
const TAKEN_TITLE_LENGTH = 34;
/** Where a longer message is cut before the ellipsis. */
const TAKEN_TITLE_CUT = 32;

export const TITLE_LENGTH = 80;

/**
 * A Thread's title from its first message: one line, without its closing punctuation, cut at a
 * word when it is long.
 */
export function titleFrom(text: string): string {
  const line = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.?!]+$/, "");
  if (line.length <= TAKEN_TITLE_LENGTH) return line;
  return `${line.slice(0, TAKEN_TITLE_CUT).replace(/\s\S*$/, "")}…`;
}

/** Why a title the user gives can't be saved, in the UI's words; empty when it can. */
export function titleProblems(title: string): string[] {
  const trimmed = title.trim();
  if (trimmed === "") return ["Give the Thread a title."];
  if (trimmed.length > TITLE_LENGTH) {
    return [`A Thread's title may be at most ${TITLE_LENGTH} characters.`];
  }
  return [];
}
