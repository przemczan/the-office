import { describe, expect, it } from "vitest";
import { roleKeyFor } from "./role-key.js";

describe("roleKeyFor", () => {
  it("joins the lower case words of the title with dashes", () => {
    expect(roleKeyFor(" Data  Analyst ")).toBe("data-analyst");
  });

  it("drops accents and punctuation", () => {
    expect(roleKeyFor("Rédacteur (QA)!")).toBe("redacteur-qa");
  });

  it("is empty when the title has no letters or digits", () => {
    expect(roleKeyFor("!!! —")).toBe("");
  });
});
