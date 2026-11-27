import { beforeEach, describe, expect, it } from "vitest";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import type { PromptTemplates } from "../../../prompt-templates/index.js";
import { promptTemplatesFor } from "../../../prompt-templates/index.fixtures.js";
import {
  LIST_PROMPT_TEMPLATES_TOOL,
  READ_PROMPT_TEMPLATE_TOOL,
} from "../../domain/session-instructions.js";
import { ANN_LEE, BEN_ITO } from "../../domain/user.fixtures.js";
import {
  A_BRIEF,
  A_GREETING,
  promptTemplateTools,
} from "./prompt-template-office-tools.fixtures.js";

const session = anOfficeToolCall("session-1");

let templates: PromptTemplates;
let office: ReturnType<typeof promptTemplateTools>;

beforeEach(async () => {
  templates = await promptTemplatesFor([A_GREETING, A_BRIEF]);
  office = promptTemplateTools(templates);
});

describe("reading prompt templates", () => {
  it("lists them by domain, each customised or default", async () => {
    await templates.save(A_GREETING.key, "Hi {{userName}}.", ANN_LEE);

    const all = await office.tool(LIST_PROMPT_TEMPLATES_TOOL).run({}, session);
    const pipelines = await office
      .tool(LIST_PROMPT_TEMPLATES_TOOL)
      .run({ domain: "pipelines" }, session);

    expect(all.text).toContain(
      "- conversations.a-greeting (conversations): A greeting. Greets the user. Customised, version 1, by Ann Lee on ",
    );
    expect(all.text).toContain(
      "- pipelines.a-brief (pipelines): A Brief. Briefs a Stage. Default.",
    );
    expect(pipelines.text).toContain("pipelines.a-brief");
    expect(pipelines.text).not.toContain("conversations.a-greeting");
  });

  it("reads one: its text, its default, its variables with their fields", async () => {
    await templates.save(A_GREETING.key, "Hi {{userName}}.", ANN_LEE);

    const { text, isError } = await office
      .tool(READ_PROMPT_TEMPLATE_TOOL)
      .run({ key: A_GREETING.key }, session);

    expect(isError).toBe(false);
    expect(text).toContain("A greeting (conversations.a-greeting): Greets the user.");
    expect(text).toContain("Text now:\nHi {{userName}}.");
    expect(text).toContain("Default:\nHello {{userName}}.");
    expect(text).toContain("- userName (text): The user's name.");
    expect(text).toContain(
      "- projects (list): The user's Projects.\n  - name: The Project's name.",
    );
  });
});

describe("the retired drafting tools", () => {
  it("are not registered: the Office actions save and reset a template now", () => {
    for (const name of ["propose_prompt_template", "propose_prompt_template_reset"]) {
      expect(() => office.tool(name)).toThrow(`No Office tool is registered as ${name}.`);
    }
  });

  it("points the reading tool at save_prompt_template", () => {
    expect(office.tool(READ_PROMPT_TEMPLATE_TOOL).description).toContain("save_prompt_template");
  });
});

describe("applying a prompt template's Proposal", () => {
  it("saves the text as a new version that keeps who applied it", async () => {
    const change = {
      kind: "prompt-template",
      key: A_GREETING.key,
      name: "A greeting",
      from: A_GREETING.text,
      to: "Hi {{userName}}.",
    } as const;

    await office.appliers.apply(change, "office-manager", BEN_ITO);

    expect(await templates.read(A_GREETING.key)).toMatchObject({
      customised: true,
      text: "Hi {{userName}}.",
      saved: { version: 1, savedBy: BEN_ITO },
    });
  });

  it("refuses once the template changed since the draft", async () => {
    await templates.save(A_GREETING.key, "Hey {{userName}}.", ANN_LEE);

    await expect(
      office.appliers.apply(
        {
          kind: "prompt-template",
          key: A_GREETING.key,
          name: "A greeting",
          from: A_GREETING.text,
          to: "Hi {{userName}}.",
        },
        "office-manager",
        BEN_ITO,
      ),
    ).rejects.toThrow("The prompt template changed after this was drafted");
    expect((await templates.read(A_GREETING.key)).text).toBe("Hey {{userName}}.");
  });

  it("resets the template to its default, not customised", async () => {
    await templates.save(A_GREETING.key, "Hi {{userName}}.", ANN_LEE);

    await office.appliers.apply(
      {
        kind: "prompt-template",
        key: A_GREETING.key,
        name: "A greeting",
        from: "Hi {{userName}}.",
        to: null,
      },
      "office-manager",
      BEN_ITO,
    );

    expect(await templates.read(A_GREETING.key)).toMatchObject({
      customised: false,
      text: A_GREETING.text,
      renderedText: A_GREETING.text,
      saved: { version: 2, text: null, savedBy: BEN_ITO },
    });
  });
});
