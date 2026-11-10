import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startCheckProblems } from "./start-check.js";
import { paths, folder, skills, anEngine, setUpEachTest } from "./start-check.fixtures.js";

setUpEachTest();

describe("startCheckProblems", () => {
  it("names every skill missing from the listing and every one it shouldn't have", async () => {
    const engine = anEngine({ listed: ["office:tdd", "vendor:deploy", "lint"] });

    await expect(startCheckProblems(engine, skills, paths)).resolves.toEqual([
      "It doesn't list deploy.",
      "It lists lint, vendor:deploy, which it shouldn't have.",
    ]);
  });

  it("refuses when its plugin isn't loaded from its folder, or the engine reports errors", async () => {
    const engine = anEngine({
      plugins: [{ name: "office", path: join(folder, "elsewhere") }],
      errorCount: 2,
    });

    await expect(startCheckProblems(engine, skills, paths)).resolves.toEqual([
      "The engine reports 2 plugin errors.",
      `The engine didn't load its skills folder ${folder} as the office plugin.`,
    ]);
  });
});
