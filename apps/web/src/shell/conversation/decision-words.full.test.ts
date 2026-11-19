import type { Attachment } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { decisionDetailsWords, namedAttachments } from "./decision-words.ts";

function anAttachment(id: string): Attachment {
  return { id, name: id, kind: "image" } as Attachment;
}

describe("namedAttachments", () => {
  it("keeps the Decision's order", () => {
    const named = namedAttachments({ attachmentIds: ["b", "a"] }, [
      anAttachment("a"),
      anAttachment("b"),
      anAttachment("c"),
    ]);
    expect(named.map(({ id }) => id)).toEqual(["b", "a"]);
  });

  it("leaves out one removed since the Decision opened", () => {
    const named = namedAttachments({ attachmentIds: ["gone", "a"] }, [anAttachment("a")]);
    expect(named.map(({ id }) => id)).toEqual(["a"]);
  });
});

describe("decisionDetailsWords", () => {
  const choice = {
    kind: "choice" as const,
    question: "Which?",
    options: ["Yes", "No"],
    recommendation: { option: 0, reason: "" },
  };
  const open = { kind: "open" as const, question: "Why?" };

  it("counts the questions and the Attachments", () => {
    expect(
      decisionDetailsWords({ questions: [choice, open, choice] }, [
        anAttachment("a"),
        anAttachment("b"),
      ]),
    ).toBe("3 questions · 2 Attachments");
    expect(decisionDetailsWords({ questions: [choice] }, [anAttachment("a")])).toBe(
      "1 question · 1 Attachment",
    );
  });

  it("leaves the Attachments out when there are none", () => {
    expect(decisionDetailsWords({ questions: [choice, open] }, [])).toBe("2 questions");
  });
});
