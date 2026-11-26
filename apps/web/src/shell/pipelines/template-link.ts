import type { Stage } from "@the-office/contracts";

/**
 * A Pipeline's Stage linked to its Stage template (spec §2.3.1): its template fields, how it differs
 * from the template, taking them back and unlinking, as the service's `stage-template-link.ts`
 * works them out. Generic over the Stage's fields, so a field a later Stage kind adds is covered.
 */

/** A Stage's Role and duty, one field: who works it. */
export const WHO_FIELD = "who";

/** Fields a template never gives: they belong to the Pipeline, or the link never crosses them. */
const PIPELINE_FIELDS: ReadonlySet<string> = new Set([
  "kind",
  "key",
  "name",
  "place",
  "position",
  "routes",
  "optional",
  "templateId",
]);

const WHO_PARTS: readonly string[] = ["role", "duty"];

/** Each template field as the Stage editor labels it; an unknown one shows its key. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  [WHO_FIELD]: "Who works it",
  session: "Session",
  mergeBaseFirst: "Merge the base first",
  effort: "Effort",
  brief: "Brief",
  budget: "Budget",
  permissions: "Permission profile",
  contextLimits: "Context limits",
  command: "Project command",
  publishTarget: "Publishes",
};

export type TemplateFields = Readonly<Record<string, unknown>>;

/** The fields of `stage` a template gives, by key, Role and duty first as `who`. */
export function templateFields(stage: Stage): TemplateFields {
  const fields: Record<string, unknown> = {};
  if (stage.kind === "agent") fields[WHO_FIELD] = asKept({ role: stage.role, duty: stage.duty });
  for (const [key, value] of Object.entries(asKept(stage))) {
    if (PIPELINE_FIELDS.has(key) || WHO_PARTS.includes(key)) continue;
    fields[key] = value;
  }
  return fields;
}

/** The template fields `stage` differs in from `template`, compared as kept. */
export function fieldsDiffering(stage: Stage, template: Stage): string[] {
  const own = templateFields(stage);
  const its = templateFields(template);
  const keys = [...new Set([...Object.keys(its), ...Object.keys(own)])];
  return keys.filter((key) => !sameAsKept(own[key], its[key]));
}

/** The template fields an edit of the template changes, from `before` to `after`. */
export function fieldsChanged(before: Stage, after: Stage): string[] {
  return fieldsDiffering(after, before);
}

/** `stage` with the named template fields set to `template`'s, its other fields and link kept. */
export function withTemplateFields(
  stage: Stage,
  template: Stage,
  fields: readonly string[],
): Stage {
  if (stage.kind !== template.kind) return stage;
  const taken = templateFields(template);
  const result: Record<string, unknown> = { ...stage };
  for (const field of fields) {
    if (PIPELINE_FIELDS.has(field)) continue;
    const parts = field === WHO_FIELD ? WHO_PARTS : [field];
    const values = field === WHO_FIELD ? asRecord(taken[WHO_FIELD]) : { [field]: taken[field] };
    for (const part of parts) {
      if (values[part] === undefined) delete result[part];
      else result[part] = values[part];
    }
  }
  // Only fields of the same kind's Stage were copied, so the result is a Stage of that kind.
  return result as Stage;
}

/** The Stage without its link, its fields as they are. */
export function unlinkedStage(stage: Stage): Stage {
  if (stage.templateId === undefined) return stage;
  const { templateId: _templateId, ...rest } = stage;
  return rest;
}

/** A template field as the Stage editor labels it. */
export function templateFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/** "Budget and Brief": the fields' labels, the last joined with "and". */
export function templateFieldWords(fields: readonly string[]): string {
  const labels = fields.map(templateFieldLabel);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/** "Same as the template", or "Differs in Budget and Brief". */
export function differenceWords(differing: readonly string[]): string {
  return differing.length === 0
    ? "Same as the template"
    : `Differs in ${templateFieldWords(differing)}`;
}

/** "Its own Budget is replaced": the fields an edit replaces that the Stage had its own of. */
export function replacedWords(fields: readonly string[]): string {
  return `Its own ${templateFieldWords(fields)} ${fields.length === 1 ? "is" : "are"} replaced`;
}

/** "1 Stage", "3 Stages". */
export function stageCount(count: number): string {
  return `${count} ${count === 1 ? "Stage" : "Stages"}`;
}

/**
 * A linked Stage's Pipeline: "Full · office-wide", or "The Office's Full" for a Project's, by its
 * Project's name (its id while the Projects aren't read).
 */
export function linkedPipelineWords(
  pipelineName: string,
  project: { readonly id: string; readonly name: string | undefined } | null,
): string {
  if (project === null) return `${pipelineName} · office-wide`;
  return `${project.name ?? project.id}'s ${pipelineName}`;
}

function sameAsKept(one: unknown, other: unknown): boolean {
  return JSON.stringify(sortedKeys(one)) === JSON.stringify(sortedKeys(other));
}

/** `value` with its objects' keys sorted, so two alike compare alike as JSON. */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, each]) => each !== undefined)
      .toSorted(([one], [other]) => one.localeCompare(other))
      .map(([key, each]) => [key, sortedKeys(each)]),
  );
}

function asKept(value: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
