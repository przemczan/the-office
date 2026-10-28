import type { Stage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { stageChanges, stagesLine } from "./pipeline-words.ts";

const LOOK: Stage = { kind: "gate", key: "look", name: "Look", optional: false };
const PUBLISH: Stage = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
};

describe("stagesLine", () => {
  it("joins the Stages' names in order", () => {
    expect(stagesLine({ stages: [LOOK, PUBLISH] })).toBe("Look → Publish");
  });
});

describe("stageChanges", () => {
  it("names the Stages added, rewritten and removed, by key", () => {
    const lint: Stage = {
      kind: "script",
      key: "lint",
      name: "Lint",
      optional: false,
      command: "lint",
    };

    expect(stageChanges([LOOK, PUBLISH], [lint, { ...PUBLISH, optional: true }])).toEqual([
      { name: "Lint", change: "added" },
      { name: "Publish", change: "changed" },
      { name: "Look", change: "removed" },
    ]);
  });

  it("finds nothing changed in Stages alike, whatever order their fields came in", () => {
    const reordered = { optional: false, name: "Look", key: "look", kind: "gate" } as const;

    expect(stageChanges([LOOK], [reordered])).toEqual([]);
  });
});
