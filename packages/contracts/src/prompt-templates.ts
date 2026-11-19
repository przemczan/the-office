import { z } from "zod";
import { webEventSchema } from "./events.js";
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
