import type { OfficeActionProposalSubject } from "@the-office/contracts";

/** A text longer than this, or with more than one line, is shown as a block rather than inline. */
const LONG_TEXT_LENGTH = 80;

/** One value of a held call's input, in words. */
export type InputValue =
  | { readonly kind: "text"; readonly text: string; readonly long: boolean }
  | { readonly kind: "subject"; readonly subject: OfficeActionProposalSubject }
  | { readonly kind: "list"; readonly entries: readonly InputEntry[] };

/** A labelled value of a held call's input. */
export interface InputEntry {
  readonly label: string;
  readonly value: InputValue;
}

/** A key as the user reads it: "taskId" is "Task", "definitionOfDone" is "Definition of done". */
export function inputLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  const withoutId = words.replace(/ ids?$/, "");
  const label = withoutId === "" ? words : withoutId;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * A held call's input as a labelled list in words: each key as a label, an id that is the call's
 * subject as its link, long texts as blocks, lists and nested objects as nested lists, and empty
 * values left out.
 */
export function inputEntries(
  input: unknown,
  subject: OfficeActionProposalSubject | null,
): InputEntry[] {
  if (!isRecord(input)) return [];
  return Object.entries(input).flatMap(([key, value]) => {
    const shown = inputValue(value, subject, isSubjectKey(key, value, subject));
    return shown === undefined ? [] : [{ label: inputLabel(key), value: shown }];
  });
}

function inputValue(
  value: unknown,
  subject: OfficeActionProposalSubject | null,
  isSubjectId: boolean,
): InputValue | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (isSubjectId && subject) return { kind: "subject", subject };
  if (typeof value === "string") {
    return {
      kind: "text",
      text: value,
      long: value.includes("\n") || value.length > LONG_TEXT_LENGTH,
    };
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return { kind: "text", text: String(value), long: false };
  }
  if (Array.isArray(value))
    return listOf(
      value.map((item) => [undefined, item]),
      subject,
    );
  if (isRecord(value)) return listOf(Object.entries(value), subject);
  return undefined;
}

function listOf(
  items: readonly (readonly [string | undefined, unknown])[],
  subject: OfficeActionProposalSubject | null,
): InputValue | undefined {
  const entries = items.flatMap(([key, item], index) => {
    const shown = inputValue(item, subject, false);
    const label = key === undefined ? String(index + 1) : inputLabel(key);
    return shown === undefined ? [] : [{ label, value: shown }];
  });
  return entries.length === 0 ? undefined : { kind: "list", entries };
}

function isSubjectKey(
  key: string,
  value: unknown,
  subject: OfficeActionProposalSubject | null,
): boolean {
  return subject !== null && value === subject.id && /id$/i.test(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
