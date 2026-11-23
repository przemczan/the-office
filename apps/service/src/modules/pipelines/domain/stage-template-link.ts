import { isDeepStrictEqual } from "node:util";
import type { Stage } from "./stage.js";
import type { StageTemplate } from "./stage-template.js";

/**
 * A Pipeline's Stage linked to its Stage template (spec §2.3.1, "A Stage linked to its Stage
 * template"): which of its fields are the template's to give, how it differs from it, and taking
 * them back. Generic over the Stage's fields, so a field a later Stage kind adds is covered.
 */

/** A Stage's Role and duty, one field: who works it. */
export const WHO_FIELD = "who";

/**
 * Fields a template never gives: those naming the Stage within its Pipeline, its place and routes,
 * which belong to the Pipeline, the rollback's `optional`, the link itself, and the kind, which a
 * link never crosses.
 */
const PIPELINE_FIELDS: ReadonlySet<string> = new Set([
  "kind",
  "key",
  "name",
  "place",
  "routes",
  "optional",
  "templateId",
]);

/** The fields Role and duty make up together. */
const WHO_PARTS: readonly string[] = ["role", "duty"];

/** A template field by its key, kept as it is stored, so undefined and left out are alike. */
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

/**
 * The template fields `stage` differs in from `template`'s Stage, in the template's order then the
 * Stage's own, compared as kept. A Stage of another kind differs in every field either has.
 */
export function fieldsDiffering(stage: Stage, template: Stage): string[] {
  const own = templateFields(stage);
  const its = templateFields(template);
  const keys = [...new Set([...Object.keys(its), ...Object.keys(own)])];
  return keys.filter((key) => !isDeepStrictEqual(own[key], its[key]));
}

/**
 * `stage` with the named template fields set to `template`'s, its other fields and link kept. A
 * template of another kind gives nothing.
 */
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
  return result as unknown as Stage;
}

/** The Stage without its link, its fields as they are. */
export function unlinkedStage(stage: Stage): Stage {
  if (stage.templateId === undefined) return stage;
  const { templateId: _templateId, ...rest } = stage;
  return rest;
}

/** The Stages without their links: a Task's own Stages are always plain copies. */
export function unlinked(stages: readonly Stage[]): Stage[] {
  return stages.map(unlinkedStage);
}

/** The Stages unlinked from the template of `templateId` alone, others' links kept. */
export function unlinkedFrom(templateId: string, stages: readonly Stage[]): Stage[] {
  return stages.map((stage) => (stage.templateId === templateId ? unlinkedStage(stage) : stage));
}

/**
 * The Stages keeping only links to a template that still exists and is of their kind: a link never
 * refuses a save, it is dropped.
 */
export function withLiveLinks(
  stages: readonly Stage[],
  templates: readonly StageTemplate[],
): Stage[] {
  const kinds = new Map(templates.map(({ id, stage }) => [id, stage.kind]));
  return stages.map((stage) =>
    stage.templateId === undefined || kinds.get(stage.templateId) === stage.kind
      ? stage
      : unlinkedStage(stage),
  );
}

function asKept(value: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
