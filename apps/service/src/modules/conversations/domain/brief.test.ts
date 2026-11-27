import { describe, expect, it } from "vitest";
import { defaultPromptTexts } from "../../prompt-templates/index.js";
import { NO_MEMORY, taskThreadBrief, withKnowledgeBase, withOfficeToolAreas } from "./brief.js";
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

describe("the Office tool areas in a Brief", () => {
  const others = [
    { area: "initiatives", tools: ["create_initiative", "drop_initiative"] },
    { area: "people", tools: ["hire_person"] },
  ];

  it("names the loaded areas and lists each other area's tools as ToolSearch loads them", () => {
    const brief = withOfficeToolAreas(PROMPTS, BRIEF, {
      loading: "deferred",
      homeAreas: ["work"],
      others,
    });

    expect(brief.text.startsWith(BRIEF.text)).toBe(true);
    expect(brief.text).toContain("tools of core, work");
    expect(brief.text).toContain("ToolSearch");
    expect(brief.text).toContain(
      "- initiatives: mcp__office__create_initiative, mcp__office__drop_initiative",
    );
    expect(brief.text).toContain("- people: mcp__office__hire_person");
    expect(brief.text).not.toContain("call_office_tool");
    expect(brief.tokens).toBeGreaterThan(BRIEF.tokens);
  });

  it("tells an engine without tool search to list and call them", () => {
    const { text } = withOfficeToolAreas(PROMPTS, BRIEF, {
      loading: "pair",
      homeAreas: [],
      others,
    });

    expect(text).toContain("tools of core.");
    expect(text).toContain("list_office_tools");
    expect(text).toContain("call_office_tool");
    expect(text).toContain("- initiatives: create_initiative, drop_initiative");
    expect(text).not.toContain("ToolSearch");
  });

  it("is left as it is where no tool is left to reach, as an Agent Stage's is", () => {
    expect(
      withOfficeToolAreas(PROMPTS, BRIEF, { loading: "pair", homeAreas: [], others: [] }),
    ).toBe(BRIEF);
  });
});
