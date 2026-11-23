import { describe, expect, it } from "vitest";
import { publishOutcome } from "./publish.js";

describe("publishOutcome", () => {
  it("is done when there was nothing to publish", () => {
    expect(
      publishOutcome({
        kind: "nothing-to-publish",
        branch: "office/task-1",
        base: { remote: "origin", branch: "main" },
      }),
    ).toEqual({
      status: "done",
      publishResult: "nothing-to-publish",
      summary: "office/task-1 adds nothing to main on origin, so there was nothing to publish.",
    });
  });
});
