import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readDefinitionIn } from "./definition-files.js";

/** This repository's own root, whose `.devcontainer/` every Task of The Office's runs in. */
const REPOSITORY = fileURLToPath(new URL("../../../../../../", import.meta.url));

describe("readDefinitionIn", () => {
  it("reads this repository's own run environment definition with no problem", async () => {
    const reading = await readDefinitionIn(REPOSITORY);

    expect(reading.problems).toEqual([]);
    expect(reading.value).toMatchObject({
      composeFiles: [".devcontainer/compose.yaml"],
      service: "checks",
      serviceImage: { kind: "build", context: ".devcontainer" },
      runServices: ["checks", "postgres"],
      volumes: ["postgres-data"],
      overrideCommand: true,
      user: "root",
    });
  });
});
