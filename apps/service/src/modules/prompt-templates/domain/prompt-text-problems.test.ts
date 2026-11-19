import { describe, expect, it } from "vitest";
import { A_TEMPLATE } from "./prompt-template.fixtures.js";
import { PROMPT_TEXT_MAX_CHARACTERS, promptTextProblems } from "./prompt-text-problems.js";

function problemsOf(text: string): ReturnType<typeof promptTextProblems> {
  return promptTextProblems(A_TEMPLATE, text);
}

describe("a Prompt template's text", () => {
  it("passes with the template's variables, sections, a list's items and fields, and comments", () => {
    expect(
      problemsOf(
        "{{title}} {{{title}}} {{&title}}{{! a note }}\n{{#urgent}}Now.{{/urgent}}{{^urgent}}Later.{{/urgent}}\n{{#files}}- {{.}}\n{{/files}}{{#stages}}{{name}}: {{outcome}} of {{title}}{{/stages}}",
      ),
    ).toEqual([]);
  });

  it("refuses a variable the template doesn't list, at its tag", () => {
    expect(problemsOf("Work on {{title}}.\n  {{branch}}")).toEqual([
      {
        message:
          "{{branch}} isn't a variable of this template. It can use {{title}}, {{urgent}}, {{files}}, {{stages}}.",
        line: 2,
        column: 3,
      },
    ]);
  });

  it("refuses a list's field and {{.}} outside its section", () => {
    expect(problemsOf("{{name}}\n{{.}}")).toMatchObject([
      { line: 1, column: 1 },
      {
        message: expect.stringContaining("used only inside the section of a list of texts"),
        line: 2,
        column: 1,
      },
    ]);
  });

  it("refuses {{.}} inside a list of records, which is read by its fields", () => {
    expect(problemsOf("{{#stages}}{{.}}{{/stages}}")).toMatchObject([{ line: 1, column: 12 }]);
  });

  it("refuses a section never closed, at its opening tag", () => {
    expect(problemsOf("Files:\n\n{{#files}}\n- {{.}}\n")).toEqual([
      { message: "{{#files}} is never closed with {{/files}}.", line: 3, column: 1 },
    ]);
  });

  it("refuses a tag never closed, and a section closed by another's tag", () => {
    expect(problemsOf("Work on {{title}} and {{title")).toEqual([
      { message: "This {{ is never closed with }}.", line: 1, column: 23 },
    ]);
    expect(problemsOf("{{#urgent}}\n{{/files}}")).toEqual([
      {
        message:
          "This closes another section while {{#urgent}} is still open: close it with {{/urgent}} first.",
        line: 2,
        column: 1,
      },
    ]);
  });

  it("refuses a partial and a change of delimiters", () => {
    expect(problemsOf("{{> footer}}")).toEqual([
      {
        message: "{{> footer}} includes another template, which isn't allowed.",
        line: 1,
        column: 1,
      },
    ]);
    expect(problemsOf("Hi\n{{=<% %>=}}")).toEqual([
      {
        message: "{{=<% %>=}} changes the {{ }} delimiters, which isn't allowed.",
        line: 2,
        column: 1,
      },
    ]);
  });

  it("refuses a text too long", () => {
    expect(problemsOf("x".repeat(PROMPT_TEXT_MAX_CHARACTERS + 1))).toEqual([
      { message: "The text is longer than 50,000 characters.", line: 1, column: 50_001 },
    ]);
  });
});
