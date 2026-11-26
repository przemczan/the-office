import type { OfficeAction } from "@the-office/contracts";
import type { z } from "zod";
import type { OfficeToolChangedField, OfficeToolDraft } from "../../ports/office-tool.js";

/**
 * The record an Office action acts on as its owning module reads it now: its title, what its
 * handlers read to decide (such as a Task's state), and its value for each field an action can
 * write, by the action's input name.
 */
export interface OfficeActionSubjectSnapshot {
  readonly title: string;
  readonly decidedBy: Readonly<Record<string, unknown>>;
  readonly values: Readonly<Record<string, unknown>>;
}

/** A text from this long, or with more than a line, is a long field: shown as a diff. */
const LONG_FIELD_LENGTH = 80;

const FIELD_LABELS: Readonly<Record<string, string>> = {
  definitionOfDone: "Definition of Done",
  engineId: "Engine",
  pipelineId: "Pipeline",
  projectId: "Project",
  shortName: "Short name",
};

/**
 * What a call of `action` with `input` changes, from the subject `snapshot`: one field for each
 * input the call gives besides the subject's own id, before and after. Its fingerprint is what the
 * handler decides by and the values of the fields it writes, so a change to either since the draft
 * means the subject changed.
 */
export function officeActionDraft<Input extends z.ZodObject>(
  action: OfficeAction<Input>,
  input: z.output<Input>,
  snapshot: OfficeActionSubjectSnapshot,
): OfficeToolDraft {
  const subject = action.subject(input);
  const given = Object.entries(input as Record<string, unknown>).filter(
    ([, value]) => value !== subject.id && value !== undefined,
  );
  const fields = given.map(([key, after]) =>
    changedField(key, snapshot.values[key], after, key in snapshot.values),
  );
  const writtenNow = Object.fromEntries(
    given.filter(([key]) => key in snapshot.values).map(([key]) => [key, snapshot.values[key]]),
  );
  return {
    subject: { ...subject, title: snapshot.title },
    fields,
    fingerprint: { subject, decidedBy: snapshot.decidedBy, writtenNow },
  };
}

function changedField(
  key: string,
  before: unknown,
  after: unknown,
  known: boolean,
): OfficeToolChangedField {
  const afterText = fieldText(after);
  const beforeText = known ? fieldText(before) : null;
  const long = [afterText, beforeText].some(
    (text) => text !== null && (text.includes("\n") || text.length > LONG_FIELD_LENGTH),
  );
  return {
    label: FIELD_LABELS[key] ?? sentenceCase(key),
    before: beforeText,
    after: afterText,
    form: long ? "long" : "short",
  };
}

function fieldText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((each) => typeof each === "string")) {
    return value.join("\n");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** "autoMode" as "Auto mode". */
function sentenceCase(key: string): string {
  const words = key.replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
