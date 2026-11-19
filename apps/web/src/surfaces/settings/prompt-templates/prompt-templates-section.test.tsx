import { afterEach, describe, expect, it } from "vitest";
import { BRIEF, shownSection, unmountSection } from "./prompt-templates-section.fixtures.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(unmountSection);

describe("Settings › Prompt templates", () => {
  it("shows the open template's name, its text in an editor and its variables", async () => {
    const { page } = await shownSection([BRIEF]);

    expect(page.querySelector(".card-head")?.textContent).toContain("Resolve's Brief");
    expect(page.querySelector("textarea")?.value).toBe("Resolve {{taskTitle}}.");
    const variables = page.querySelector("[aria-label='Variables']")?.textContent ?? "";
    expect(variables).toContain("{{taskTitle}}");
    expect(variables).toContain("{{#files}}{{path}}{{/files}}");
  });
});
