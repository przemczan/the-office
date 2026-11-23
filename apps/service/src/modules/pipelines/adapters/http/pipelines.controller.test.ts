import type { INestApplication } from "@nestjs/common";
import { pipelineListSchema, pipelineSchema } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { ENDED_CONFLICT, RESOLVE_KEY, RESOLVE_TEST_KEY } from "../../domain/publish-stages.js";
import { RESOLVE_TEMPLATE_BRIEF } from "../../domain/resolve-template.js";
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
        duty: "implements",
        brief: "Make the smallest change that meets the Definition of Done.",
        session: "fresh",
        budget: 200_000,
        routes: [{ to: "tests", condition: null, limit: null }],
        place: { column: 0, row: 0 },
      },
      {
        kind: "script",
        key: "tests",
        name: "Tests",
        optional: false,
        command: "test",
        routes: [
          {
            to: "implement",
            toName: "Implement",
            condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "failed" }] },
            limit: 2,
          },
          { to: "publish", condition: null, limit: null },
        ],
        place: { column: 1, row: 0 },
      },
      {
        kind: "agent",
        key: RESOLVE_KEY,
        name: "Resolve",
        optional: false,
        duty: "implements",
        brief: RESOLVE_TEMPLATE_BRIEF,
        session: "fresh",
        budget: 450_000,
        mergeBaseFirst: true,
        templateId: "resolve",
        routes: [
          { to: RESOLVE_TEST_KEY, toName: "Test after Resolve", condition: null, limit: null },
        ],
        place: { column: 0, row: 1 },
      },
      {
        kind: "script",
        key: RESOLVE_TEST_KEY,
        name: "Test after Resolve",
        optional: false,
        command: "test",
        routes: [
          {
            to: RESOLVE_KEY,
            toName: "Resolve",
            condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "failed" }] },
            limit: 2,
          },
          { to: "publish", toName: "Publish", condition: null, limit: null },
        ],
        place: { column: 1, row: 1 },
      },
      {
        kind: "publish",
        key: "publish",
        name: "Publish",
        optional: false,
        routes: [
          { to: RESOLVE_KEY, toName: "Resolve", condition: ENDED_CONFLICT, limit: 3 },
          { to: null, condition: null, limit: null },
        ],
        place: { column: 2, row: 0 },
      },
    ]);
  });

  it("gives a Publish Stage's target", async () => {
    const response = await fetch(`${url}/api/pipelines/proof-of-concept`);

    expect(pipelineSchema.parse(await response.json()).stages.at(-1)).toMatchObject({
      kind: "publish",
      key: "publish",
      publishTarget: "branch-only",
    });
  });

  it("answers 404 with the reason for a Pipeline that doesn't exist", async () => {
    const response = await fetch(`${url}/api/pipelines/nowhere`);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ message: 'There is no Pipeline "nowhere".' });
  });
});
