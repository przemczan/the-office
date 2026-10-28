import { describe, expect, it } from "vitest";
import { pipelineUseLine } from "./pipeline-use-words.ts";

describe("pipelineUseLine", () => {
  it("names the Projects it is the default of, and counts Tasks in the singular or plural", () => {
    expect(
      pipelineUseLine({
        defaultFor: [
          { projectId: "a", name: "Admin panel" },
          { projectId: "b", name: "Mobile" },
        ],
        notStarted: 1,
        running: 1,
      }),
    ).toBe(
      "Default for Admin panel, Mobile · 1 not started Task uses it · 1 running Task keeps the copy it started with",
    );
    expect(pipelineUseLine({ defaultFor: [], notStarted: 2, running: 0 })).toBe(
      "Default for no Project · 2 not started Tasks use it · 0 running Tasks keep the copy they started with",
    );
  });
});
