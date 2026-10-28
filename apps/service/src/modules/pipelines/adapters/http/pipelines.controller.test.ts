import type { INestApplication } from "@nestjs/common";
import { pipelineListSchema, pipelineSchema } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { PipelineLibraryModule } from "../../pipeline-library.module.js";

let app: INestApplication;
let url: string;

beforeEach(async () => {
  ({ app, url } = await startTestApplication({ database: true, imports: [PipelineLibraryModule] }));
});

afterEach(async () => {
  await app.close();
});

describe("GET /api/pipelines", () => {
  // Other test files add Pipelines to the shared test database; the built-ins come first.
  it("lists the library, the built-ins first, as the contract describes it", async () => {
    const response = await fetch(`${url}/api/pipelines`);

    expect(response.status).toBe(200);
    const pipelines = pipelineListSchema.parse(await response.json());
    expect(pipelines.slice(0, 5).map((pipeline) => pipeline.name)).toEqual([
      "Full",
      "Quick fix",
      "Document",
      "Onboard",
      "Proof of concept",
    ]);
  });
});

describe("GET /api/pipelines/:id", () => {
  it("reads one Pipeline with its Stages", async () => {
    const response = await fetch(`${url}/api/pipelines/quick-fix`);

    expect(response.status).toBe(200);
    expect(pipelineSchema.parse(await response.json()).stages).toEqual([
      {
        kind: "agent",
        key: "implement",
        name: "Implement",
        optional: false,
        role: "developer",
        brief: "Make the smallest change that meets the Definition of Done.",
        session: "fresh",
        budget: 200_000,
      },
      {
        kind: "script",
        key: "tests",
        name: "Tests",
        optional: false,
        command: "test",
        onFailure: { goBackTo: "implement", rounds: 2 },
      },
      { kind: "script", key: "publish", name: "Publish", optional: false, command: "publish" },
    ]);
  });

  it("answers 404 with the reason for a Pipeline that doesn't exist", async () => {
    const response = await fetch(`${url}/api/pipelines/nowhere`);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ message: 'There is no Pipeline "nowhere".' });
  });
});
