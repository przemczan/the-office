import {
  stageTemplateListSchema,
  stageTemplateSchema,
  type StageTemplate,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtInStageTemplates } from "../../domain/built-in-stage-templates.js";
import { gate, scriptStage } from "../../domain/stage.fixtures.js";
import {
  StageTemplateAdded,
  StageTemplateRemoved,
  StageTemplateSaved,
} from "../../domain/stage-template-events.js";
import type { Stage } from "../../domain/stage.js";
import {
  startPipelinesApplication,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import { aStage, refusal } from "./stage-templates.controller.fixtures.js";

// The test database is shared by every test file: these tests make templates of their own, under
// names no one else uses, and never change the built-ins.

let pipelines: PipelinesApplication;
let url: string;

beforeAll(async () => {
  pipelines = await startPipelinesApplication();
  url = `${await pipelines.app.getUrl()}/api`;
});

afterAll(async () => {
  await pipelines.app.close();
});

function send(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function publishedFor(
  type: typeof StageTemplateAdded | typeof StageTemplateSaved | typeof StageTemplateRemoved,
  stageTemplateId: string,
): boolean {
  return pipelines.published.some(
    (event) => event instanceof type && event.stageTemplateId === stageTemplateId,
  );
}

async function added(stage: Stage = aStage()): Promise<StageTemplate> {
  const response = await send("POST", "/stage-templates", { stage });
  expect(response.status).toBe(201);
  return stageTemplateSchema.parse(await response.json());
}

describe("GET /api/stage-templates", () => {
  it("lists the templates in library order, the built-ins first", async () => {
    const template = await added();

    const response = await send("GET", "/stage-templates");

    const listed = stageTemplateListSchema.parse(await response.json());
    expect(listed.slice(0, builtInStageTemplates.length)).toEqual(builtInStageTemplates);
    expect(listed.findIndex(({ id }) => id === template.id)).toBeGreaterThanOrEqual(
      builtInStageTemplates.length,
    );
  });
});

describe("POST /api/stage-templates", () => {
  it("adds a template under an id of its own, dropping its routes and place", async () => {
    const stage = aStage({
      routes: [{ to: "plan", condition: null, limit: 2 }],
      place: { column: 1, row: 0 },
    });

    const template = await added(stage);

    expect(template).toEqual({
      id: expect.any(String),
      stage: { ...stage, routes: undefined, place: undefined },
    });
    expect(template.stage).not.toHaveProperty("routes");
    const read = await send("GET", `/stage-templates/${template.id}`);
    expect(stageTemplateSchema.parse(await read.json())).toEqual(template);
    expect(publishedFor(StageTemplateAdded, template.id)).toBe(true);
  });

  it("refuses a blank name, a name another template has in any case, and a broken Stage rule", async () => {
    const blank = await send("POST", "/stage-templates", { stage: gate({ name: " " }) });
    const taken = await send("POST", "/stage-templates", {
      stage: scriptStage({ name: "review & FIX", command: "build", publishTarget: "branch-only" }),
    });

    expect(await refusal(blank)).toEqual([
      { stageKey: null, at: null, level: "problem", text: "Give it a name." },
    ]);
    expect(await refusal(taken)).toEqual([
      {
        stageKey: null,
        at: null,
        level: "problem",
        text: 'Another Stage template is named "review & FIX".',
      },
      {
        stageKey: null,
        at: null,
        level: "problem",
        text: "Only a Publish Stage has a publish target.",
      },
    ]);
  });
});
