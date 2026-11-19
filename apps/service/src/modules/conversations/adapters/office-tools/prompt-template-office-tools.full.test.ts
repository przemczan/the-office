import { PROMPT_TEMPLATE_MAX_CHARACTERS } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { refusalOf, type PromptTemplates } from "../../../prompt-templates/index.js";
import { promptTemplatesFor } from "../../../prompt-templates/index.fixtures.js";
import type { ProposedPromptTemplateChange } from "../../domain/proposal.js";
import {
  PROPOSE_PROMPT_TEMPLATE_RESET_TOOL,
  PROPOSE_PROMPT_TEMPLATE_TOOL,
  READ_PROMPT_TEMPLATE_TOOL,
} from "../../domain/session-instructions.js";
import { ANN_LEE, BEN_ITO } from "../../domain/user.fixtures.js";
import {
  A_BRIEF,
  A_GREETING,
  promptTemplateTools,
} from "./prompt-template-office-tools.fixtures.js";

const session = anOfficeToolCall("session-1");

const NO_TEMPLATE = 'The Office has no prompt template "conversations.unknown".';

async function anOffice(saved: readonly { key: string; text: string }[] = []) {
  const templates = await promptTemplatesFor([A_GREETING, A_BRIEF], saved);
  return { templates, ...promptTemplateTools(templates) };
}

function aChange(fields: Partial<ProposedPromptTemplateChange>): ProposedPromptTemplateChange {
  return {
    kind: "prompt-template",
    key: A_GREETING.key,
    name: "A greeting",
    from: A_GREETING.text,
    to: "Hi {{userName}}.",
    ...fields,
  };
}

/** What a save of `text` in Settings answers, its refusal's reasons in one message. */
function settingsRefusal(templates: PromptTemplates, text: string): string {
  return refusalOf(templates.check(A_GREETING.key, text)).reasons.join(" ");
}

describe("reading a prompt template", () => {
  it("shows the saved text's problems, and no default while it isn't customised", async () => {
    const { tool } = await anOffice([{ key: A_GREETING.key, text: "Hi {{name}}." }]);

    const { text } = await tool(READ_PROMPT_TEMPLATE_TOOL).run({ key: A_GREETING.key }, session);
    const brief = await tool(READ_PROMPT_TEMPLATE_TOOL).run({ key: A_BRIEF.key }, session);

    expect(text).toContain(
      "Problems with the saved text, so the default renders instead:\n- Line 1, column 4: {{name}} isn't a variable of this template.",
    );
    expect(brief.text).toContain("Default.");
    expect(brief.text).not.toContain("Default:\n");
    expect(brief.text).not.toContain("Problems");
  });

  it("answers an unknown key with the words the Agent acts on", async () => {
    const { tool } = await anOffice();

    for (const [name, input] of [
      [READ_PROMPT_TEMPLATE_TOOL, { key: "conversations.unknown" }],
      [PROPOSE_PROMPT_TEMPLATE_TOOL, { key: "conversations.unknown", text: "Hi." }],
      [PROPOSE_PROMPT_TEMPLATE_RESET_TOOL, { key: "conversations.unknown" }],
    ] as const) {
      expect(await tool(name).run(input, session)).toEqual({ text: NO_TEMPLATE, isError: true });
    }
  });
});

describe("drafting a prompt template's change", () => {
  it.each([
    ["a partial", "Hi {{> other}}."],
    ["a delimiter change", "{{=<% %>=}} Hi <%userName%>."],
    ["an unknown variable", "Hi {{name}}."],
    ["broken syntax", "Hi {{#projects}}."],
    ["too long a text", "x".repeat(PROMPT_TEMPLATE_MAX_CHARACTERS + 1)],
  ])("refuses %s with the words a save in Settings gives", async (_kind, text) => {
    const { tool, drafted, templates } = await anOffice();

    const result = await tool(PROPOSE_PROMPT_TEMPLATE_TOOL).run(
      { key: A_GREETING.key, text },
      session,
    );

    expect(result).toEqual({ text: settingsRefusal(templates, text), isError: true });
    expect(result.text).not.toBe("");
    expect(drafted).toEqual([]);
  });

  it("refuses the text the template has already, and a reset of a template at its default", async () => {
    const { tool, drafted } = await anOffice();

    const same = await tool(PROPOSE_PROMPT_TEMPLATE_TOOL).run(
      { key: A_GREETING.key, text: A_GREETING.text },
      session,
    );
    const reset = await tool(PROPOSE_PROMPT_TEMPLATE_RESET_TOOL).run(
      { key: A_GREETING.key },
      session,
    );

    expect(same).toEqual({ text: "The template is this text already.", isError: true });
    expect(reset).toEqual({ text: "The template is its default already.", isError: true });
    expect(drafted).toEqual([]);
  });

  it("keeps the text as given, spaces and all", async () => {
    const { tool, drafted } = await anOffice();

    await tool(PROPOSE_PROMPT_TEMPLATE_TOOL).run(
      { key: A_GREETING.key, text: "  Hi {{userName}}.\n" },
      session,
    );

    expect(drafted).toEqual([aChange({ to: "  Hi {{userName}}.\n" })]);
  });
});

describe("applying a prompt template's Proposal", () => {
  it("refuses a text the Settings save would refuse, in the words drafting gives", async () => {
    const { appliers, templates } = await anOffice();
    const broken = "Hi {{name}}.";

    await expect(
      appliers.apply(aChange({ to: broken }), "office-manager", BEN_ITO),
    ).rejects.toThrow(settingsRefusal(templates, broken));
    expect(await appliers.problemsWith(aChange({ to: broken }))).toEqual(
      refusalOf(templates.check(A_GREETING.key, broken)).reasons,
    );
    expect((await templates.read(A_GREETING.key)).customised).toBe(false);
  });

  it("refuses a stale reset, leaving the template as it is", async () => {
    const { appliers, templates } = await anOffice();
    await templates.save(A_GREETING.key, "Hi {{userName}}.", ANN_LEE);
    const reset = aChange({ from: "Hi {{userName}}.", to: null });
    await templates.save(A_GREETING.key, "Hey {{userName}}.", ANN_LEE);

    await expect(appliers.apply(reset, "office-manager", BEN_ITO)).rejects.toThrow(
      "The prompt template changed after this was drafted",
    );
    expect((await templates.read(A_GREETING.key)).text).toBe("Hey {{userName}}.");
  });

  it("refuses a template no module registers", async () => {
    const { appliers } = await anOffice();

    await expect(
      appliers.apply(aChange({ key: "conversations.unknown" }), "office-manager", BEN_ITO),
    ).rejects.toThrow(NO_TEMPLATE);
  });
});
