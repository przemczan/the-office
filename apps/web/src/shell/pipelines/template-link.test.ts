import type { Stage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  differenceWords,
  fieldsDiffering,
  linkedPipelineWords,
  replacedWords,
  stageCount,
  templateFieldLabel,
  unlinkedStage,
  withTemplateFields,
} from "./template-link.ts";

const TEMPLATE: Stage = {
  kind: "agent",
  key: "review",
  name: "Review",
  optional: false,
  role: "reviewer",
  brief: "Review it.",
  session: "fresh",
  budget: 200_000,
};

const LINKED: Stage = {
  ...TEMPLATE,
  key: "review-2",
  name: "Review again",
  templateId: "review",
  routes: [{ to: null, condition: null }],
  place: { column: 2, row: 0 },
};

describe("fieldsDiffering", () => {
  it("never counts the name, key, routes, place or loop", () => {
    expect(fieldsDiffering(LINKED, TEMPLATE)).toEqual([]);
  });

  it("names who works it first, then the Stage's fields, a field left out included", () => {
    const edited: Stage = {
      ...LINKED,
      role: undefined,
      duty: "implements",
      budget: 1,
      effort: "max",
    };

    expect(fieldsDiffering(edited, TEMPLATE)).toEqual(["who", "budget", "effort"]);
  });

  it("compares objects whatever the order of their keys", () => {
    const one: Stage = { ...LINKED, permissions: { edit: false, web: false } };
    const other: Stage = { ...TEMPLATE, permissions: { web: false, edit: false } };

    expect(fieldsDiffering(one, other)).toEqual([]);
  });
});

describe("withTemplateFields", () => {
  it("takes one field back, the rest and the link kept", () => {
    const edited: Stage = { ...LINKED, budget: 1, brief: "Own." };

    expect(withTemplateFields(edited, TEMPLATE, ["budget"])).toEqual({
      ...edited,
      budget: 200_000,
    });
  });

  it("takes who works it whole", () => {
    const edited: Stage = { ...LINKED, role: undefined, duty: "implements" };

    const taken = withTemplateFields(edited, TEMPLATE, ["who"]);

    expect(taken).toMatchObject({ role: "reviewer" });
    expect("duty" in taken).toBe(false);
  });
});

describe("words", () => {
  it("says the Stage is the same, or the fields it differs in, as the Stage editor labels them", () => {
    expect(differenceWords([])).toBe("Same as the template");
    expect(differenceWords(["budget", "brief"])).toBe("Differs in Budget and Brief");
    expect(differenceWords(["who", "budget", "brief"])).toBe(
      "Differs in Who works it, Budget and Brief",
    );
    expect(templateFieldLabel("somethingNew")).toBe("somethingNew");
  });

  it("says which of the Stage's own fields an edit replaces", () => {
    expect(replacedWords(["budget"])).toBe("Its own Budget is replaced");
    expect(replacedWords(["who", "brief"])).toBe("Its own Who works it and Brief are replaced");
  });

  it("names a linked Stage's Pipeline, office-wide or its Project's", () => {
    expect(linkedPipelineWords("Full", null)).toBe("Full · office-wide");
    expect(linkedPipelineWords("Full", { id: "p-1", name: "The Office" })).toBe(
      "The Office's Full",
    );
    expect(linkedPipelineWords("Full", { id: "p-1", name: undefined })).toBe("p-1's Full");
  });

  it("counts Stages", () => {
    expect(stageCount(1)).toBe("1 Stage");
    expect(stageCount(3)).toBe("3 Stages");
  });

  it("unlinks a Stage, keeping its fields", () => {
    const { templateId: _templateId, ...plain } = LINKED;

    expect(unlinkedStage(LINKED)).toEqual(plain);
  });
});
