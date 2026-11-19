import { describe, expect, it } from "vitest";
import { EventBus } from "../../../../platform/events/event-bus.js";
import {
  PromptTemplateCatalog,
  PromptTemplates,
  promptTextProblems,
} from "../../../prompt-templates/index.js";
import { PromptTemplateRepositoryForTests } from "../../../prompt-templates/index.fixtures.js";
import { WORK_PROMPT_TEMPLATES } from "../../domain/work-prompt-templates.js";
import { goldenCaseOutputs } from "../../domain/work-prompts.golden-cases.fixtures.js";
import { GOLDEN_OUTPUTS } from "../../domain/work-prompts.golden.js";
import { WorkPromptTemplates } from "./work-prompt-templates-registration.js";

function registered(): PromptTemplateCatalog {
  const catalog = new PromptTemplateCatalog();
  new WorkPromptTemplates(catalog).onModuleInit();
  return catalog;
}

describe("Work's prompt templates", () => {
  it("all 15 register in a fresh catalog's work domain, no key twice", () => {
    const work = registered().byDomain("work");

    expect(work).toEqual(WORK_PROMPT_TEMPLATES);
    expect(work.map(({ key }) => key)).toEqual([
      "work.shaping-instructions",
      "work.planning-instructions",
      "work.initiative-planning-instructions",
      "work.asking-instructions",
      "work.shaping-opening",
      "work.created-initiative-shaping-opening",
      "work.make-a-plan-opening",
      "work.planning-after-restart-opening",
      "work.initiative-planning-opening",
      "work.initiative-planning-after-restart-opening",
      "work.planning-brief",
      "work.asking-brief",
      "work.shaping-brief",
      "work.initiative-planning-brief",
      "work.task-who-asked",
    ]);
  });

  it("each default passes the prompt text check", () => {
    const problems = WORK_PROMPT_TEMPLATES.flatMap((template) =>
      promptTextProblems(template, template.text).map(
        ({ message, line, column }) => `${template.key} ${line}:${column} ${message}`,
      ),
    );
    expect(problems).toEqual([]);
  });

  it("describe every variable they list, and use each one and each field", () => {
    const problems = WORK_PROMPT_TEMPLATES.flatMap(({ key, text, variables }) =>
      Object.entries(variables).flatMap(([name, variable]) => [
        ...(variable.description.trim() === "" ? [`${key} ${name} has no description`] : []),
        ...(text.includes(`{{${name}}}`) || text.includes(`{{#${name}}}`)
          ? []
          : [`${key} ${name} is unused`]),
        ...Object.keys(variable.kind === "list" ? (variable.fields ?? {}) : {})
          .filter((field) => !new RegExp(`\\{\\{[#^]?${field}\\}\\}`).test(text))
          .map((field) => `${key} ${name}.${field} is unused`),
      ]),
    );
    expect(problems).toEqual([]);
  });

  it("render as before with the texts PromptTemplates loads while none was saved", async () => {
    const templates = new PromptTemplates(
      registered(),
      new PromptTemplateRepositoryForTests(),
      new EventBus(),
    );

    const prompts = await templates.textsOf(WORK_PROMPT_TEMPLATES);

    expect(goldenCaseOutputs(prompts)).toEqual(GOLDEN_OUTPUTS);
  });
});
