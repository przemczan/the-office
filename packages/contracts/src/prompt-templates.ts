import { z } from "zod";
import { webEventSchema } from "./events.js";
import { officeAction } from "./office-actions.js";
import { userRefSchema } from "./users.js";

/** The longest text a Prompt template may hold; the service refuses a longer one on save. */
export const PROMPT_TEMPLATE_MAX_CHARACTERS = 50_000;

/**
 * The Settings tab a Prompt template sits in: one per module that owns prompts. Adding one is a
 * deliberate contract change.
 */
export const promptTemplateDomainSchema = z.enum(["conversations", "work", "pipelines", "engine"]);
export type PromptTemplateDomain = z.infer<typeof promptTemplateDomainSchema>;

/**
 * How a variable is used in `{{ }}`: `text` is written as it is (`{{name}}`), a `flag` opens a
 * section when true (`{{#name}}…{{/name}}`), and a `list` repeats its section for each item, read
 * as `{{.}}`, or by its `fields` when its items are records.
 */
export const promptVariableKindSchema = z.enum(["text", "flag", "list"]);
export type PromptVariableKind = z.infer<typeof promptVariableKindSchema>;

export const promptVariableFieldSchema = z.object({
  name: z.string(),
  description: z.string(),
});
export type PromptVariableField = z.infer<typeof promptVariableFieldSchema>;

export const promptVariableSchema = z.object({
  name: z.string(),
  description: z.string(),
  kind: promptVariableKindSchema,
  /** A list of records' fields; absent on any other variable. */
  fields: z.array(promptVariableFieldSchema).optional(),
});
export type PromptVariable = z.infer<typeof promptVariableSchema>;

/** One thing wrong with a text, where it is: line and column count from 1. */
export const promptTextProblemSchema = z.object({
  message: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});
export type PromptTextProblem = z.infer<typeof promptTextProblemSchema>;

/**
 * A template as Settings lists it: `customised` while a text other than the default is saved,
 * `hasProblems` while the saved text no longer passes the check, so the default renders.
 */
export const promptTemplateSummarySchema = z.object({
  key: z.string(),
  domain: promptTemplateDomainSchema,
  name: z.string(),
  description: z.string(),
  customised: z.boolean(),
  hasProblems: z.boolean(),
  /** The newest saved version, 0 while nothing was ever saved. */
  version: z.number().int().nonnegative(),
  /** When and by whom the newest version was saved; null while nothing was ever saved. */
  savedAt: z.iso.datetime().nullable(),
  savedBy: userRefSchema.nullable(),
});
export type PromptTemplateSummary = z.infer<typeof promptTemplateSummarySchema>;

/** GET /settings/prompt-templates?domain=: every template of the domain, or all of them. */
export const promptTemplateListSchema = z.array(promptTemplateSummarySchema);

/**
 * GET /settings/prompt-templates/:key: the saved text (the default while none is saved), the
 * default, the variables, and the saved text's problems: while it has any, the default renders.
 */
export const promptTemplateSchema = promptTemplateSummarySchema.extend({
  text: z.string(),
  defaultText: z.string(),
  variables: z.array(promptVariableSchema),
  problems: z.array(promptTextProblemSchema),
});
export type PromptTemplate = z.infer<typeof promptTemplateSchema>;

/** PUT /settings/prompt-templates/:key and POST …/check: the text to save or check. */
export const promptTemplateTextSchema = z.object({ text: z.string() });
export type PromptTemplateText = z.infer<typeof promptTemplateTextSchema>;

const promptTemplateKeyInput = z
  .string()
  .min(1)
  .describe("The Prompt template's key, as list_prompt_templates gives it.");

/** Office action: a Prompt template's text saved. */
export const SAVE_PROMPT_TEMPLATE_ACTION = officeAction({
  name: "save_prompt_template",
  title: "Save a Prompt template",
  description:
    "Saves a Prompt template's text whole, as the newest version; read it first with read_prompt_template, which lists its variables. Refused with every problem of the text, such as an unknown variable or an unclosed section, and when it is over the longest text a template may hold.",
  input: promptTemplateTextSchema.extend({ key: promptTemplateKeyInput }),
  answer: promptTemplateSchema,
  route: { method: "PUT", path: "/settings/prompt-templates/:key" },
  area: "library",
  group: "promptTemplates",
  subject: ({ key }) => ({ kind: "prompt-template", id: key }),
});

/** Office action: a Prompt template reset to its default text. */
export const RESET_PROMPT_TEMPLATE_ACTION = officeAction({
  name: "reset_prompt_template",
  title: "Reset a Prompt template",
  description: "Resets a Prompt template to its default text; the saved versions stay as history.",
  input: z.object({ key: promptTemplateKeyInput }),
  answer: promptTemplateSchema,
  route: { method: "DELETE", path: "/settings/prompt-templates/:key" },
  area: "library",
  group: "promptTemplates",
  subject: ({ key }) => ({ kind: "prompt-template", id: key }),
});

/** The Office actions Prompt templates carry out. */
export const PROMPT_TEMPLATES_OFFICE_ACTIONS = [
  SAVE_PROMPT_TEMPLATE_ACTION,
  RESET_PROMPT_TEMPLATE_ACTION,
] as const;

/** POST /settings/prompt-templates/:key/check: what is wrong with the text, empty when nothing. */
export const promptTemplateCheckSchema = z.object({
  problems: z.array(promptTextProblemSchema),
});
export type PromptTemplateCheck = z.infer<typeof promptTemplateCheckSchema>;

export const promptTemplatesQuerySchema = z.object({
  domain: promptTemplateDomainSchema.optional(),
});
export type PromptTemplatesQuery = z.infer<typeof promptTemplatesQuerySchema>;

/** A refused save (422): every reason in words, and each problem of the text where it is. */
export const promptTemplateRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
  problems: z.array(promptTextProblemSchema),
});
export type PromptTemplateRefusal = z.infer<typeof promptTemplateRefusalSchema>;

/** A template's text was saved or reset to its default, so an open Settings page reads it again. */
export const promptTemplateWebEventSchema = webEventSchema.extend({
  type: z.literal("prompt-template.changed"),
  key: z.string(),
});
export type PromptTemplateWebEvent = z.infer<typeof promptTemplateWebEventSchema>;
