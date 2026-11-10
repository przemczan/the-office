import { describe, expect, it } from "vitest";
import { publishOutcome, pullRequestText } from "./publish.js";
import type { Stage } from "./stage.js";

const publish: Stage = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
};
const task = {
  title: "Rename a device",
  definitionOfDone: ["The new name shows on the list", "The rename persists"],
};

describe("pullRequestText", () => {
  it("holds only the Definition of Done before any Stage has a result", () => {
    expect(pullRequestText(task, [publish], [], "publish").body).toBe(
      "## Definition of Done\n\n- [ ] The new name shows on the list\n- [ ] The rename persists",
    );
  });
});

describe("publishOutcome", () => {
  it("says it merged the base in first when Resolve had merged the branch before", () => {
    expect(
      publishOutcome({
        kind: "merged",
        branch: "office/task-1",
        into: { remote: "origin", branch: "main" },
        commit: "0123456789abcdef0123456789abcdef01234567",
        baseTakenIn: "by-merge",
      }),
    ).toEqual({
      status: "done",
      summary:
        "Merged main, which had moved on, into office/task-1, then merged it into main on origin, which is now at 01234567.",
    });
  });

  it("is done when there was nothing to publish", () => {
    expect(
      publishOutcome({
        kind: "nothing-to-publish",
        branch: "office/task-1",
        base: { remote: "origin", branch: "main" },
      }),
    ).toEqual({
      status: "done",
      summary: "office/task-1 adds nothing to main on origin, so there was nothing to publish.",
    });
  });
});
