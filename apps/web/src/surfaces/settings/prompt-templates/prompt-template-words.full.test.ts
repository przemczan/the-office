import { PROMPT_TEMPLATE_MAX_CHARACTERS, type PromptTemplateSummary } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  domainsOf,
  overLimit,
  problemLine,
  savedLine,
  variableUsage,
} from "./prompt-template-words.ts";

const NEVER_SAVED: PromptTemplateSummary = {
  key: "work.resolve-brief",
  domain: "work",
  name: "Resolve's Brief",
  description: "",
  customised: false,
  hasProblems: false,
  version: 0,
  savedAt: null,
  savedBy: null,
};

const ANN = { userId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", name: "Ann Lee" };
const formatDate = (isoTime: string): string => `on ${isoTime.slice(0, 10)}`;

describe("domainsOf", () => {
  it("gives the domains that have templates, in the contract's order", () => {
    expect(domainsOf([{ domain: "engine" }, { domain: "work" }, { domain: "engine" }])).toEqual([
      "work",
      "engine",
    ]);
    expect(domainsOf([])).toEqual([]);
  });
});

describe("variableUsage", () => {
  it("writes a text as it is, a flag as a section and a list as a repeated one", () => {
    expect(variableUsage({ name: "title", description: "", kind: "text" })).toBe("{{title}}");
    expect(variableUsage({ name: "urgent", description: "", kind: "flag" })).toBe(
      "{{#urgent}}…{{/urgent}}",
    );
    expect(variableUsage({ name: "names", description: "", kind: "list" })).toBe(
      "{{#names}}{{.}}{{/names}}",
    );
    expect(
      variableUsage({
        name: "files",
        description: "",
        kind: "list",
        fields: [
          { name: "path", description: "" },
          { name: "reason", description: "" },
        ],
      }),
    ).toBe("{{#files}}{{path}} {{reason}}{{/files}}");
  });
});

describe("problemLine", () => {
  it("says where the problem is", () => {
    expect(problemLine({ line: 1, column: 4, message: "Unclosed section." })).toBe(
      "Line 1, column 4: Unclosed section.",
    );
  });
});

describe("savedLine", () => {
  it("says the default ships with The Office while nobody saved a version", () => {
    expect(savedLine(NEVER_SAVED, formatDate)).toBe("The default that ships with The Office");
  });

  it("names who saved the customised text and when", () => {
    const saved = {
      ...NEVER_SAVED,
      customised: true,
      version: 2,
      savedBy: ANN,
      savedAt: "2026-11-10T10:00:00.000Z",
    };
    expect(savedLine(saved, formatDate)).toBe("Saved by Ann Lee, on 2026-11-10");
  });

  it("names who reset it to default and when", () => {
    const reset = { ...NEVER_SAVED, version: 3, savedBy: ANN, savedAt: "2026-11-11T10:00:00.000Z" };
    expect(savedLine(reset, formatDate)).toBe("Reset to default by Ann Lee, on 2026-11-11");
  });
});

describe("overLimit", () => {
  it("says nothing up to the limit and how far over past it, untrimmed", () => {
    expect(overLimit("x".repeat(PROMPT_TEMPLATE_MAX_CHARACTERS))).toBeUndefined();
    expect(overLimit(`${"x".repeat(PROMPT_TEMPLATE_MAX_CHARACTERS)}  `)).toBe(
      "2 over the limit of 50,000 characters.",
    );
  });
});
