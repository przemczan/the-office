import Mustache, { type TemplateSpans } from "mustache";
import type { PromptTemplate, PromptVariables } from "./prompt-template.js";

/** The longest text a template may hold; mirrors the contracts' `PROMPT_TEMPLATE_MAX_CHARACTERS`. */
export const PROMPT_TEXT_MAX_CHARACTERS = 50_000;

/** One thing wrong with a text, where it is: line and column count from 1. */
export interface PromptTextProblem {
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

/**
 * What a tag may name where it stands: inside a list's section the list's fields too, and `.` for
 * an item that is a string.
 */
interface Scope {
  readonly names: ReadonlySet<string>;
  readonly itemIsText: boolean;
}

/**
 * Everything wrong with `text` as the template's text, empty when nothing: broken Mustache syntax,
 * a variable the template doesn't list, a partial or a change of delimiters, or a text too long.
 * Save, the check route and Proposals all check with it.
 */
export function promptTextProblems(
  template: Pick<PromptTemplate, "variables">,
  text: string,
): PromptTextProblem[] {
  if (text.length > PROMPT_TEXT_MAX_CHARACTERS) {
    return [
      problemAt(
        text,
        PROMPT_TEXT_MAX_CHARACTERS,
        `The text is longer than ${PROMPT_TEXT_MAX_CHARACTERS.toLocaleString("en-US")} characters.`,
      ),
    ];
  }
  let spans: TemplateSpans;
  try {
    spans = Mustache.parse(text);
  } catch (error) {
    return [syntaxProblem(text, error instanceof Error ? error.message : String(error))];
  }
  const scope: Scope = { names: new Set(Object.keys(template.variables)), itemIsText: false };
  return spanProblems(spans, text, template.variables, scope);
}

/** Where `offset` falls in `text`, as the problem's line and column. */
function problemAt(text: string, offset: number, message: string): PromptTextProblem {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  return { message, line: before.split("\n").length, column: offset - lineStart + 1 };
}

function spanProblems(
  spans: TemplateSpans,
  text: string,
  variables: PromptVariables,
  scope: Scope,
): PromptTextProblem[] {
  return spans.flatMap((span): PromptTextProblem[] => {
    const [type, name, start, end] = span;
    const tag = text.slice(start, end);
    switch (type) {
      case "text":
      case "!":
        return [];
      case ">":
        return [problemAt(text, start, `${tag} includes another template, which isn't allowed.`)];
      case "=":
        return [
          problemAt(text, start, `${tag} changes the {{ }} delimiters, which isn't allowed.`),
        ];
      case "name":
      case "&":
        return nameProblems(text, start, tag, name, variables, scope);
      case "#":
      case "^": {
        const problems = nameProblems(text, start, tag, name, variables, scope);
        const inner = span.length > 4 ? (span[4] as TemplateSpans) : [];
        return [
          ...problems,
          ...spanProblems(inner, text, variables, innerScope(type, name, variables, scope)),
        ];
      }
      default:
        return [problemAt(text, start, `${tag} isn't a tag a template can use.`)];
    }
  });
}

function nameProblems(
  text: string,
  start: number,
  tag: string,
  name: string,
  variables: PromptVariables,
  scope: Scope,
): PromptTextProblem[] {
  if (name === ".") {
    return scope.itemIsText
      ? []
      : [
          problemAt(
            text,
            start,
            `${tag} stands for a list's item, so it is used only inside the section of a list of texts, such as {{#list}}{{.}}{{/list}}; a list of records is read by its fields.`,
          ),
        ];
  }
  if (scope.names.has(name)) return [];
  const usable = Object.keys(variables);
  const offered =
    usable.length === 0
      ? "This template uses no variables."
      : `It can use ${usable.map((variable) => `{{${variable}}}`).join(", ")}.`;
  return [problemAt(text, start, `${tag} isn't a variable of this template. ${offered}`)];
}

/** A list's section repeats for each item, which `.` and the list's fields then name. */
function innerScope(
  type: "#" | "^",
  name: string,
  variables: PromptVariables,
  scope: Scope,
): Scope {
  const variable = variables[name];
  if (type !== "#" || variable?.kind !== "list") return scope;
  return {
    names: new Set([...scope.names, ...Object.keys(variable.fields ?? {})]),
    itemIsText: variable.fields === undefined,
  };
}

const UNCLOSED_TAG = /^Unclosed tag at (\d+)$/;
const UNOPENED_SECTION = /^Unopened section "(.*)" at (\d+)$/;
const UNCLOSED_SECTION = /^Unclosed section "(.*)" at (\d+)$/;

/** Mustache's own syntax error, in plain words at the tag it is about. */
function syntaxProblem(text: string, error: string): PromptTextProblem {
  const unclosedTag = UNCLOSED_TAG.exec(error);
  if (unclosedTag) {
    const offset = Math.max(text.lastIndexOf("{{", Number(unclosedTag[1])), 0);
    return problemAt(text, offset, "This {{ is never closed with }}.");
  }
  const unopened = UNOPENED_SECTION.exec(error);
  if (unopened) {
    const [, name = "", offset] = unopened;
    return problemAt(
      text,
      Number(offset),
      `{{/${name}}} closes a section that is never opened with {{#${name}}}.`,
    );
  }
  const unclosed = UNCLOSED_SECTION.exec(error);
  if (unclosed) {
    const [, name = "", offset] = unclosed;
    const at = Number(offset);
    // Mustache names the end of the text when the section is still open there: point at its tag.
    if (at >= text.length) {
      const opening = lastOpeningOf(text, name);
      return problemAt(
        text,
        opening?.index ?? at,
        `${opening?.tag ?? `{{#${name}}}`} is never closed with {{/${name}}}.`,
      );
    }
    return problemAt(
      text,
      at,
      `This closes another section while {{#${name}}} is still open: close it with {{/${name}}} first.`,
    );
  }
  if (error.startsWith("Invalid tags")) {
    const offset = Math.max(text.indexOf("{{="), 0);
    return problemAt(text, offset, "Changing the {{ }} delimiters isn't allowed.");
  }
  return problemAt(text, 0, error);
}

function lastOpeningOf(
  text: string,
  name: string,
): { readonly index: number; readonly tag: string } | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openings = [...text.matchAll(new RegExp(`\\{\\{\\s*[#^]\\s*${escaped}\\s*\\}\\}`, "g"))];
  const last = openings.at(-1);
  return last === undefined ? undefined : { index: last.index, tag: last[0] };
}
