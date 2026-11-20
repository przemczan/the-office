import { describe, expect, it } from "vitest";
import {
  defaultPromptTexts,
  PromptTemplateCatalog,
  promptTextProblems,
} from "../../../prompt-templates/index.js";
import {
  API_OUTPUT_REMINDER,
  ENGINE_PROMPT_TEMPLATES,
} from "../../domain/engine-prompt-templates.js";
import { EnginePromptTemplates } from "./engine-prompt-templates.js";

function registered(): PromptTemplateCatalog {
  const catalog = new PromptTemplateCatalog();
  new EnginePromptTemplates(catalog).onModuleInit();
  return catalog;
}

describe("The Engine module's prompt templates", () => {
  it("all register in a fresh catalog, each default passing the check, no key twice", () => {
    expect(registered().byDomain("engine")).toEqual(ENGINE_PROMPT_TEMPLATES);
  });

  it("have keys of the engine domain and defaults without a problem", () => {
    for (const template of ENGINE_PROMPT_TEMPLATES) {
      expect(template.key.startsWith("engine.")).toBe(true);
      expect(promptTextProblems(template, template.text)).toEqual([]);
    }
  });

  it("word the API engine's output reminder at its default as the engine did before", () => {
    expect(
      defaultPromptTexts(ENGINE_PROMPT_TEMPLATES).render(API_OUTPUT_REMINDER, {
        structuredOutputTool: "StructuredOutput",
      }),
    ).toBe(
      "Your turn isn't over: call the StructuredOutput tool with your answer, in the shape its input asks for.",
    );
  });

  it("use every variable and field they list", () => {
    const unused = ENGINE_PROMPT_TEMPLATES.flatMap(({ key, text, variables }) =>
      Object.entries(variables).flatMap(([name, variable]) => [
        ...(text.includes(`{{${name}}}`) ||
        text.includes(`{{#${name}}}`) ||
        text.includes(`{{^${name}}}`)
          ? []
          : [`${key} ${name}`]),
        ...Object.keys(variable.kind === "list" ? (variable.fields ?? {}) : {})
          .filter((field) => !new RegExp(`\\{\\{[#^]?${field}\\}\\}`).test(text))
          .map((field) => `${key} ${name}.${field}`),
      ]),
    );
    expect(unused).toEqual([]);
  });
});
