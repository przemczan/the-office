import { describe, expect, it } from "vitest";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { PromptTemplateCatalog, PromptTemplates } from "../../../prompt-templates/index.js";
import { PromptTemplateRepositoryForTests } from "../../../prompt-templates/index.fixtures.js";
import { CONVERSATIONS_PROMPT_TEMPLATES } from "../../domain/conversations-prompt-templates.js";
import { goldenCaseOutputs } from "../../domain/conversations-prompts.golden-cases.fixtures.js";
import { GOLDEN_OUTPUTS } from "../../domain/conversations-prompts.golden.js";
import { CALLING_RULE } from "../../domain/session-instructions.js";
import {
  CARETAKER_INSTRUCTIONS,
  CHAT_INSTRUCTIONS,
} from "../../domain/session-instruction-templates.js";
import { ConversationsPromptTemplates } from "./conversations-prompt-templates.js";

function registered(): PromptTemplateCatalog {
  const catalog = new PromptTemplateCatalog();
  new ConversationsPromptTemplates(catalog).onModuleInit();
  return catalog;
}

describe("Conversations' prompt templates", () => {
  it("all register in a fresh catalog, each default passing the check, no key twice", () => {
    expect(registered().byDomain("conversations")).toEqual(CONVERSATIONS_PROMPT_TEMPLATES);
  });

  it("use every variable and field they list", () => {
    const unused = CONVERSATIONS_PROMPT_TEMPLATES.flatMap(({ key, text, variables }) =>
      Object.entries(variables).flatMap(([name, variable]) => [
        ...(text.includes(`{{${name}}}`) || text.includes(`{{#${name}}}`)
          ? []
          : [`${key} ${name}`]),
        ...Object.keys(variable.kind === "list" ? (variable.fields ?? {}) : {})
          .filter((field) => !new RegExp(`\\{\\{[#^]?${field}\\}\\}`).test(text))
          .map((field) => `${key} ${name}.${field}`),
      ]),
    );
    expect(unused).toEqual([]);
  });

  it("render as before with the texts PromptTemplates loads while none was saved", async () => {
    const templates = new PromptTemplates(
      registered(),
      new PromptTemplateRepositoryForTests(),
      new EventBus(),
    );

    const prompts = await templates.textsOf(CONVERSATIONS_PROMPT_TEMPLATES);

    expect(goldenCaseOutputs(prompts)).toEqual(GOLDEN_OUTPUTS);
  });

  it("keep the calling rule in the chat's and the Caretaker's defaults", () => {
    expect(CHAT_INSTRUCTIONS.text).toContain(CALLING_RULE);
    expect(CARETAKER_INSTRUCTIONS.text).toContain(CALLING_RULE);
  });
});
