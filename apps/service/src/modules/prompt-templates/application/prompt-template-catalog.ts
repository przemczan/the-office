import { Injectable } from "@nestjs/common";
import type { PromptTemplate, PromptTemplateDomain } from "../domain/prompt-template.js";
import { PromptTemplateNotFound } from "../domain/prompt-template-not-found.js";
import { promptTextProblems } from "../domain/prompt-text-problems.js";

/** `<domain>.<kebab-name>`, such as `pipelines.resolve-brief`. */
const KEY = /^[a-z]+\.[a-z0-9]+(-[a-z0-9]+)*$/;

/** A variable is named as a JavaScript identifier, as the code that renders it gives its value. */
const VARIABLE_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * Every Prompt template the modules render (spec §2.2). A module registers its templates once, in
 * its `onModuleInit`; one that breaks the catalog's rules stops The Office from starting.
 */
@Injectable()
export class PromptTemplateCatalog {
  private readonly templates = new Map<string, PromptTemplate>();

  register(templates: readonly PromptTemplate[]): void {
    for (const template of templates) {
      const problem = this.problemOf(template);
      if (problem !== undefined) {
        throw new Error(`The prompt template ${template.key} can't be registered: ${problem}`);
      }
      this.templates.set(template.key, template);
    }
  }

  /** The domain's templates, or all of them, in the order registered. */
  byDomain(domain?: PromptTemplateDomain): PromptTemplate[] {
    return [...this.templates.values()].filter(
      (template) => domain === undefined || template.domain === domain,
    );
  }

  /** Throws PromptTemplateNotFound for a key no module registered. */
  get(key: string): PromptTemplate {
    const template = this.templates.get(key);
    if (!template) throw new PromptTemplateNotFound(key);
    return template;
  }

  private problemOf(template: PromptTemplate): string | undefined {
    if (this.templates.has(template.key)) return "a template with this key is registered already.";
    if (!KEY.test(template.key) || !template.key.startsWith(`${template.domain}.`)) {
      return `its key must be "${template.domain}." followed by a name in kebab-case.`;
    }
    const badName = Object.keys(template.variables).find((name) => !VARIABLE_NAME.test(name));
    if (badName !== undefined) return `its variable "${badName}" isn't a name in camelCase.`;
    const problems = promptTextProblems(template, template.text);
    if (problems.length > 0) {
      const words = problems.map(
        ({ message, line, column }) => `line ${line}, column ${column}: ${message}`,
      );
      return `its default text fails the check, ${words.join(" ")}`;
    }
    return undefined;
  }
}
