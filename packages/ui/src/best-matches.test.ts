import { describe, expect, it } from "vitest";
import { bestMatches } from "./best-matches.ts";

const named = (...labels: string[]) => labels.map((label) => ({ label }));
const labelsOf = (options: readonly { label: string }[]) => options.map(({ label }) => label);

describe("bestMatches", () => {
  it("ranks a name starting with the text first, then a word starting with it, then one containing it", () => {
    const options = named("Offline sync", "Sync the invoices", "Async exports", "Billing");

    expect(labelsOf(bestMatches(options, "sync", 10))).toEqual([
      "Sync the invoices",
      "Offline sync",
      "Async exports",
    ]);
  });

  it("matches whatever the case and keeps the order given among equal matches", () => {
    const options = named("Payments rework", "payroll export", "PAY-2 hotfix");

    expect(labelsOf(bestMatches(options, "PAY", 10))).toEqual([
      "Payments rework",
      "payroll export",
      "PAY-2 hotfix",
    ]);
  });

  it("shows at most the limit, best matches first", () => {
    const options = named(...Array.from({ length: 12 }, (_, index) => `Task ${index}`), "Tasks");

    const matches = bestMatches(options, "task", 10);

    expect(matches).toHaveLength(10);
    expect(labelsOf(matches)).toEqual(labelsOf(options.slice(0, 10)));
  });

  it("gives the first options when no text is typed", () => {
    const options = named(...Array.from({ length: 15 }, (_, index) => `Initiative ${index}`));

    expect(bestMatches(options, "  ", 10)).toEqual(options.slice(0, 10));
  });

  it("gives none when no name holds the text", () => {
    expect(bestMatches(named("Offline sync"), "invoice", 10)).toEqual([]);
  });
});
