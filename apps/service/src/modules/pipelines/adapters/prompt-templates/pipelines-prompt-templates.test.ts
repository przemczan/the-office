import { describe, expect, it } from "vitest";
import { PromptTemplateCatalog, promptTextProblems } from "../../../prompt-templates/index.js";
import { PIPELINES_PROMPT_TEMPLATES } from "../../domain/pipelines-prompt-templates.js";
import { PipelinesPromptTemplates } from "./pipelines-prompt-templates.js";

function registered(): PromptTemplateCatalog {
  const catalog = new PromptTemplateCatalog();
  new PipelinesPromptTemplates(catalog).onModuleInit();
  return catalog;
}

describe("Pipelines' prompt templates", () => {
  it("all register in a fresh catalog", () => {
    expect(registered().byDomain("pipelines")).toEqual(PIPELINES_PROMPT_TEMPLATES);
  });

  it("have keys of Pipelines' own", () => {
    for (const { key } of PIPELINES_PROMPT_TEMPLATES)
      expect(key.startsWith("pipelines.")).toBe(true);
  });

  it("have default texts that pass the check", () => {
    const problems = PIPELINES_PROMPT_TEMPLATES.flatMap((template) =>
      promptTextProblems(template, template.text).map(
        ({ message }) => `${template.key}: ${message}`,
      ),
    );
    expect(problems).toEqual([]);
  });
});
