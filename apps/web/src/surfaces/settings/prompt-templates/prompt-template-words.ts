import {
  PROMPT_TEMPLATE_MAX_CHARACTERS,
  promptTemplateDomainSchema,
  type PromptTemplateDomain,
  type PromptTemplateSummary,
  type PromptTextProblem,
  type PromptVariable,
  type PromptVariableKind,
} from "@the-office/contracts";

/** Each domain's tab, by the module that owns its prompts. */
export const DOMAIN_LABELS: Readonly<Record<PromptTemplateDomain, string>> = {
  conversations: "Conversations",
  work: "Work",
  pipelines: "Pipelines",
  engine: "Engine",
};

/** How each kind of variable is named beside it. */
export const VARIABLE_KIND_LABELS: Readonly<Record<PromptVariableKind, string>> = {
  text: "Text",
  flag: "Flag",
  list: "List",
};

/** The domains that have templates, in the contract's order: one tab each. */
export function domainsOf(
  summaries: readonly Pick<PromptTemplateSummary, "domain">[],
): PromptTemplateDomain[] {
  return promptTemplateDomainSchema.options.filter((domain) =>
    summaries.some((summary) => summary.domain === domain),
  );
}

/**
 * How the variable is written in a template: a text as it is, a flag as a section shown when it is
 * true, a list as a section repeated for each item, read as `{{.}}` or by its fields.
 */
export function variableUsage({ name, kind, fields }: PromptVariable): string {
  if (kind === "text") return `{{${name}}}`;
  if (kind === "flag") return `{{#${name}}}…{{/${name}}}`;
  const inside =
    fields && fields.length > 0 ? fields.map((field) => fieldUsage(field.name)).join(" ") : "{{.}}";
  return `{{#${name}}}${inside}{{/${name}}}`;
}

/** How a list's field is written inside its section. */
export function fieldUsage(field: string): string {
  return `{{${field}}}`;
}

/** A problem of the text where it is. */
export function problemLine({ line, column, message }: PromptTextProblem): string {
  return `Line ${line}, column ${column}: ${message}`;
}

/** Who made the template's newest version and when, or that nobody ever changed it. */
export function savedLine(
  { customised, savedBy, savedAt }: PromptTemplateSummary,
  formatDate: (isoTime: string) => string,
): string {
  if (!savedBy || !savedAt) return "The default that ships with The Office";
  const when = formatDate(savedAt);
  return customised
    ? `Saved by ${savedBy.name}, ${when}`
    : `Reset to default by ${savedBy.name}, ${when}`;
}

/** How far the text runs over the limit, or undefined while it fits. Counted as it is, untrimmed. */
export function overLimit(text: string): string | undefined {
  const over = text.length - PROMPT_TEMPLATE_MAX_CHARACTERS;
  if (over <= 0) return undefined;
  return `${over.toLocaleString("en-US")} over the limit of ${PROMPT_TEMPLATE_LIMIT_WORDS}.`;
}

export const PROMPT_TEMPLATE_LIMIT_WORDS = `${PROMPT_TEMPLATE_MAX_CHARACTERS.toLocaleString("en-US")} characters`;
