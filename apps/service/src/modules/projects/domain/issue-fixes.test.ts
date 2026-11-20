import { describe, expect, it } from "vitest";
import { withFixes } from "./issue-fixes.js";

const MESSAGE = {
  subject: "fix(live-view): the Live view wakes up with the laptop",
  body: "It listens for the page becoming visible again.",
  whole:
    "fix(live-view): the Live view wakes up with the laptop\n\nIt listens for the page becoming visible again.",
};

describe("Fixes #n in what Publish lands", () => {
  it("adds a line per issue to the whole message and to the body, in order", () => {
    expect(withFixes(MESSAGE, [418, 7])).toEqual({
      subject: MESSAGE.subject,
      body: `${MESSAGE.body}\n\nFixes #7\nFixes #418`,
      whole: `${MESSAGE.whole}\n\nFixes #7\nFixes #418`,
    });
  });

  it("never adds a line twice, whatever closing keyword is there already", () => {
    const named = {
      ...MESSAGE,
      body: `${MESSAGE.body}\n\nCloses #7`,
      whole: `${MESSAGE.whole}\n\nCloses #7`,
    };

    expect(withFixes(named, [7, 7, 71])).toEqual({
      ...named,
      body: `${named.body}\n\nFixes #71`,
      whole: `${named.whole}\n\nFixes #71`,
    });
    const again = withFixes(withFixes(MESSAGE, [5]), [5]);
    expect(again.whole.match(/Fixes #5/g)).toHaveLength(1);
    expect(again.body.match(/Fixes #5/g)).toHaveLength(1);
  });

  it("leaves the message as it is with no issue, and fills an empty body", () => {
    expect(withFixes(MESSAGE, [])).toBe(MESSAGE);
    expect(withFixes({ subject: "chore: x", body: "", whole: "chore: x" }, [3])).toEqual({
      subject: "chore: x",
      body: "Fixes #3",
      whole: "chore: x\n\nFixes #3",
    });
  });
});
