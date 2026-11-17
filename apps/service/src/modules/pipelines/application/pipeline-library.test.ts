import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { builtInPipelines } from "../domain/built-in-pipelines.js";
import { straightLineFlow } from "../domain/flow.js";
import type { Pipeline } from "../domain/pipeline.js";
import { PipelineLibraryModule } from "../pipeline-library.module.js";
import { PipelineRepository } from "../ports/pipeline-repository.js";
import { PipelineLibrary } from "./pipeline-library.js";

// The test database is shared by every test file: these add Pipelines of their own and never change
// the built-ins, which others read.

let app: INestApplication;
let library: PipelineLibrary;
let repository: PipelineRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true, imports: [PipelineLibraryModule] }));
  library = app.get(PipelineLibrary);
  repository = app.get(PipelineRepository);
});

afterAll(async () => {
  await app.close();
});

function aPipeline(fields: Partial<Pipeline> = {}): Pipeline {
  const id = randomUUID();
  return {
    id,
    name: `Library ${id}`,
    description: "For a test.",
    stages: [{ kind: "script", key: "build", name: "Build", optional: false, command: "build" }],
    ...fields,
  };
}

describe("PipelineLibrary", () => {
  it("starts with the built-ins its migration seeded, in their order", async () => {
    const listed = await library.list();

    // Migration 0162 converted the seeded Stages to flows, as straightLineFlow does.
    expect(listed.slice(0, builtInPipelines.length)).toEqual(
      builtInPipelines.map((pipeline) => ({
        ...pipeline,
        stages: straightLineFlow(pipeline.stages),
      })),
    );
  });

  it("finds a Pipeline by its id", async () => {
    await expect(library.find("document")).resolves.toMatchObject({ name: "Document" });
    await expect(library.find("nightly")).resolves.toBeUndefined();
  });

  it("knows which Pipelines it has", async () => {
    await expect(library.has("quick-fix")).resolves.toBe(true);
    await expect(library.has("nightly")).resolves.toBe(false);
  });

  it("names each duty its Agent Stages name once, apart from the Roles", async () => {
    const named = await library.rolesNamed();

    // Other test files add Pipelines naming Roles to the shared database.
    expect([...named.duties]).toEqual(expect.arrayContaining(["implements", "onboards-projects"]));
    expect(named.roles).not.toContain("implements");
  });

  it("lists a Pipeline added later after the built-ins, and reads it as saved until removed", async () => {
    const added = aPipeline();
    await repository.add(added);

    const ids = (await library.list()).map(({ id }) => id);
    expect(ids.indexOf(added.id)).toBeGreaterThanOrEqual(builtInPipelines.length);

    const saved = {
      ...added,
      description: "Saved.",
      stages: [{ kind: "gate", key: "look", name: "Look", optional: false } as const],
    };
    await repository.save(saved);
    await expect(library.find(added.id)).resolves.toEqual({
      ...saved,
      stages: straightLineFlow(saved.stages),
    });

    await repository.remove(added.id);
    await expect(library.has(added.id)).resolves.toBe(false);
  });

  it("refuses a second Pipeline of the same name in any case", async () => {
    const first = aPipeline();
    await repository.add(first);

    await expect(
      repository.add(aPipeline({ name: first.name.toUpperCase() })),
    ).rejects.toMatchObject({ cause: { constraint: "pipelines_name" } });
  });
});
