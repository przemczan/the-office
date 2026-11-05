import { describe, expect, it } from "vitest";
import {
  definitionOfDoneSummary,
  descriptionSummary,
  planSummary,
  reportedMetCount,
  statementsOf,
} from "./planning-words.ts";

describe("statementsOf", () => {
  it("takes one statement per line, trimmed, leaving out blank lines", () => {
    const text = ["  Sign-in returns to the page it left. ", "", "The tests pass.", "   "].join(
      "\n",
    );

    expect(statementsOf(text)).toEqual(["Sign-in returns to the page it left.", "The tests pass."]);
  });
});

describe("reportedMetCount", () => {
  it("counts only the numbers that are statements", () => {
    expect(reportedMetCount(["One.", "Two."], [2, 5])).toBe(1);
  });
});

describe("definitionOfDoneSummary", () => {
  const statements = ["One.", "Two."];

  it("says when none is written", () => {
    expect(
      definitionOfDoneSummary(
        { state: "backlog", definitionOfDone: [], definitionOfDoneConfirmed: false },
        [],
      ),
    ).toBe("Not written yet");
  });

  it("before Start counts the statements and says if they wait for the user", () => {
    const planned = { state: "planning", definitionOfDone: statements } as const;

    expect(definitionOfDoneSummary({ ...planned, definitionOfDoneConfirmed: false }, [])).toBe(
      "2 statements · not confirmed yet",
    );
    expect(definitionOfDoneSummary({ ...planned, definitionOfDoneConfirmed: true }, [])).toBe(
      "2 statements",
    );
  });

  it("from Start says how many are Reported met", () => {
    const running = {
      state: "in-progress",
      definitionOfDone: statements,
      definitionOfDoneConfirmed: true,
    } as const;

    expect(definitionOfDoneSummary(running, [1, 2])).toBe("2 of 2 Reported met");
    expect(definitionOfDoneSummary(running, [2])).toBe("1 of 2 Reported met");
  });
});

describe("descriptionSummary", () => {
  it("says when there is none", () => {
    expect(descriptionSummary({ description: "" })).toBe("None");
  });

  it("takes the first line without its Markdown marks", () => {
    expect(descriptionSummary({ description: "Keep **the page**.\n\nAnd its filters." })).toBe(
      "Keep the page.",
    );
  });
});

describe("planSummary", () => {
  it("says when there is no Plan", () => {
    expect(planSummary({ plan: "", filesToChange: [] })).toBe("No Plan yet");
  });

  it("takes the first line without its Markdown marks", () => {
    expect(planSummary({ plan: "## Keep **the path**\n\nThen the rest.", filesToChange: [] })).toBe(
      "Keep the path",
    );
    expect(planSummary({ plan: "1. Read the `redirect`", filesToChange: [] })).toBe(
      "Read the redirect",
    );
  });

  it("counts the files it expects to change", () => {
    expect(planSummary({ plan: "Keep it.", filesToChange: ["src/a.ts"] })).toBe(
      "Keep it. · 1 file",
    );
    expect(planSummary({ plan: "Keep it.", filesToChange: ["src/a.ts", "src/b.ts"] })).toBe(
      "Keep it. · 2 files",
    );
  });
});
