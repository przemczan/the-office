export const TITLE_LENGTH = 120;

const RECORD_NAMES = { Idea: "An Idea", Task: "A Task" } as const;

/** Why a title can't be kept, or undefined when it can; `record` names what it titles. */
export function titleProblem(title: string, record: keyof typeof RECORD_NAMES): string | undefined {
  const trimmed = title.trim();
  if (trimmed === "") return `Give the ${record} a title.`;
  if (trimmed.length > TITLE_LENGTH) {
    return `${RECORD_NAMES[record]}'s title may be at most ${TITLE_LENGTH} characters.`;
  }
  if (/[\r\n]/.test(trimmed)) return `${RECORD_NAMES[record]}'s title must be one line.`;
  return undefined;
}
