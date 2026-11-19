import Mustache from "mustache";
import { describe, expect, it } from "vitest";
import { A_TEMPLATE } from "./prompt-template.fixtures.js";
import { defaultPromptTexts, PromptTexts } from "./prompt-texts.js";

const VALUES = {
  title: "Rename <Device> & co",
  urgent: true,
  files: ["a.ts", "b.ts"],
  stages: [{ name: "Tests", outcome: "failed" }],
};

describe("rendering a Prompt template", () => {
  it("writes values as they are, never HTML-escaped, and leaves Mustache's own escape alone", () => {
    const escapeBefore = Mustache.escape;

    expect(defaultPromptTexts([A_TEMPLATE]).render(A_TEMPLATE, VALUES)).toBe(
      "Work on Rename <Device> & co. It is urgent.",
    );
    expect(Mustache.escape).toBe(escapeBefore);
    expect(Mustache.render("{{title}}", VALUES)).toBe("Rename &lt;Device&gt; &amp; co");
  });

  it("renders the loaded text: lists by item and by field, flags as sections", () => {
    const texts = new PromptTexts(
      new Map([
        [
          A_TEMPLATE.key,
          "{{^urgent}}Calm.{{/urgent}}\n{{#files}}\n- {{.}}\n{{/files}}\n{{#stages}}{{name}}: {{outcome}}{{/stages}}",
        ],
      ]),
    );

    expect(texts.render(A_TEMPLATE, VALUES)).toBe("\n- a.ts\n- b.ts\nTests: failed");
  });

  it("throws for a template whose text wasn't loaded", () => {
    expect(() => new PromptTexts(new Map()).render(A_TEMPLATE, VALUES)).toThrow(
      "pipelines.a-brief wasn't loaded",
    );
  });
});
