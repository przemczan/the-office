import { describe, expect, it } from "vitest";
import { defaultPromptTexts } from "../../prompt-templates/index.js";
import { NO_MEMORY, taskThreadBrief, withKnowledgeBase } from "./brief.js";
import { CONVERSATIONS_PROMPT_TEMPLATES } from "./conversations-prompt-templates.js";

const PROMPTS = defaultPromptTexts(CONVERSATIONS_PROMPT_TEMPLATES);

const BRIEF = taskThreadBrief(PROMPTS, {
  record: "## The Task\n\nExport the report.",
  continuing: false,
  answered: [],
  open: undefined,
  memory: NO_MEMORY,
});

describe("the knowledge base in a Brief", () => {
  it("leads the Brief with one line naming its index at its path in the install, read-only", () => {
    const brief = withKnowledgeBase(BRIEF, "/opt/the-office/docs/spec/README.md");

    expect(brief.text).toBe(
      `The Office's knowledge base, about The Office itself, starts at its index, /opt/the-office/docs/spec/README.md. It is read-only.\n\n${BRIEF.text}`,
    );
    expect(brief.tokens).toBeGreaterThan(BRIEF.tokens);
  });

  it("is left out where the install has none", () => {
    expect(withKnowledgeBase(BRIEF, undefined)).toEqual(BRIEF);
  });
});
