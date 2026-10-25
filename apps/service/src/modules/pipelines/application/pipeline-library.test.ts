import { describe, expect, it } from "vitest";
import { PipelineLibrary } from "./pipeline-library.js";

const library = new PipelineLibrary();

describe("PipelineLibrary", () => {
  it("finds a built-in Pipeline by its id", async () => {
    await expect(library.find("document")).resolves.toMatchObject({ name: "Document" });
    await expect(library.find("nightly")).resolves.toBeUndefined();
  });

  it("knows which Pipelines it has", async () => {
    await expect(library.has("quick-fix")).resolves.toBe(true);
    await expect(library.has("nightly")).resolves.toBe(false);
  });
});
