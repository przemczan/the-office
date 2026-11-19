/** The Settings tab a Prompt template sits in: one per module that owns prompts. */
export type PromptTemplateDomain = "conversations" | "work" | "pipelines" | "engine";

/**
 * What a template may use in `{{ }}`, each with a short description for Settings: `text` is written
 * as it is, a `flag` opens a section when true, and a `list` repeats its section for each item,
 * read as `{{.}}`, or by its `fields` (name → description) when its items are records.
 */
export type PromptVariable =
  | { readonly kind: "text"; readonly description: string }
  | { readonly kind: "flag"; readonly description: string }
  | {
      readonly kind: "list";
      readonly description: string;
      readonly fields?: Readonly<Record<string, string>>;
    };

export type PromptVariables = Readonly<Record<string, PromptVariable>>;

type PromptValue<Variable extends PromptVariable> = Variable extends { readonly kind: "text" }
  ? string
  : Variable extends { readonly kind: "flag" }
    ? boolean
    : Variable extends { readonly fields: infer Fields }
      ? readonly { readonly [Field in keyof Fields]: string }[]
      : readonly string[];

/**
 * The values a template renders with, one per variable it lists. Only strings, booleans and
 * arrays: never a function, so a text can't reach Mustache's lambdas.
 */
export type PromptValues<Variables extends PromptVariables> = {
  readonly [Name in keyof Variables]: PromptValue<Variables[Name]>;
};

/** One text The Office gives an Agent or a session, with the default that ships with the code. */
export interface PromptTemplate<Variables extends PromptVariables = PromptVariables> {
  /** `<domain>.<kebab-name>`, such as `pipelines.resolve-brief`. */
  readonly key: string;
  readonly domain: PromptTemplateDomain;
  readonly name: string;
  /** What the text is for, in a sentence, as Settings shows it. */
  readonly description: string;
  /** The default text. */
  readonly text: string;
  readonly variables: Variables;
}

/** Declares a template, its values' type taken from its variables. */
export function promptTemplate<const Variables extends PromptVariables>(
  template: PromptTemplate<Variables>,
): PromptTemplate<Variables> {
  return template;
}
