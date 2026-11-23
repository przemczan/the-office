import { randomUUID } from "node:crypto";
import {
  pipelineCheckSchema,
  stageTemplateSchema,
  type StageTemplate,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtInStageTemplates } from "../../domain/built-in-stage-templates.js";
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
import { aPerson } from "../../ports/pipelines-ports.fixtures.js";
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
  it("reads one template, or answers 404 for an id it doesn't know", async () => {
    const read = await send("GET", "/stage-templates/review-and-fix");
    const unknown = await send("GET", "/stage-templates/nowhere");

    expect(stageTemplateSchema.parse(await read.json())).toEqual(builtInStageTemplates[2]);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({
      message: 'There is no Stage template "nowhere".',
    });
  });
});

describe("POST /api/stage-templates", () => {
  it("adds a template whose Role nobody fills, or whose session continues the Stage before", async () => {
    const stage = aStage({ role: "devops", session: "continue" });

    expect((await added(stage)).stage).toEqual(stage);
  });

  it("keeps the Stage's Project commands, and reads them back the same", async () => {
    const stage = aStage({ permissions: { commands: ["test", "lint"] } });
    const template = await added(stage);

    const read = await send("GET", `/stage-templates/${template.id}`);

    expect(stageTemplateSchema.parse(await read.json()).stage).toEqual(stage);
  });
});

describe("PUT /api/stage-templates/:id", () => {
  it("saves the template's Stage, keeping its id and dropping a loop target", async () => {
    const template = await added();
    const stage = aStage({ budget: 50_000, onFailure: { goBackTo: "plan", rounds: 1 } });

    const response = await send("PUT", `/stage-templates/${template.id}`, { stage });

    expect(response.status).toBe(200);
    const saved = stageTemplateSchema.parse(await response.json());
    expect(saved).toEqual({ id: template.id, stage: { ...stage, onFailure: undefined } });
    expect(saved.stage).not.toHaveProperty("onFailure");
    expect(publishedFor(StageTemplateSaved, template.id)).toBe(true);
  });

  it("keeps a template's own name, and refuses another's", async () => {
    const template = await added();
    const other = await added();

    const own = await send("PUT", `/stage-templates/${template.id}`, {
      stage: { ...template.stage, brief: "Changed." },
    });
    const others = await send("PUT", `/stage-templates/${template.id}`, {
      stage: { ...template.stage, name: other.stage.name.toUpperCase() },
    });

    expect(own.status).toBe(200);
    expect(await refusal(others)).toEqual([
      {
        stageKey: null,
        at: null,
        level: "problem",
        text: `Another Stage template is named "${other.stage.name.toUpperCase()}".`,
      },
    ]);
  });

  it("answers 404 for a template the library doesn't have", async () => {
    expect((await send("PUT", "/stage-templates/nowhere", { stage: aStage() })).status).toBe(404);
  });
});

describe("DELETE /api/stage-templates/:id", () => {
  it("removes a template, and answers 404 once it is gone", async () => {
    const template = await added();

    const removed = await send("DELETE", `/stage-templates/${template.id}`);
    const again = await send("DELETE", `/stage-templates/${template.id}`);

    expect(removed.status).toBe(204);
    expect(publishedFor(StageTemplateRemoved, template.id)).toBe(true);
    expect((await send("GET", `/stage-templates/${template.id}`)).status).toBe(404);
    expect(again.status).toBe(404);
  });
});

describe("POST /api/stage-templates/check", () => {
  it("answers what a save would be refused for, apart from the Role flags it saves anyway", async () => {
    const roleKey = `reviewer-${randomUUID()}`;
    pipelines.people.people.set(roleKey, {
      ...aPerson("Grace"),
      card: { ...aPerson("Grace").card, taskLimit: "none" },
    });

    const response = await send("POST", "/stage-templates/check", {
      stage: aStage({ name: "Implement", role: roleKey }),
    });

    expect(response.status).toBe(200);
    expect(pipelineCheckSchema.parse(await response.json())).toEqual({
      problems: [
        {
          stageKey: null,
          at: null,
          level: "problem",
          text: 'Another Stage template is named "Implement".',
        },
        {
          stageKey: null,
          at: null,
          level: "warning",
          text: `Grace's Task limit is none, so ${roleKey} only talks and can't work a Stage.`,
        },
      ],
    });
  });

  it("flags a Role whose person was let go, and permissions wider than the Role card's", async () => {
    const roleKey = `writer-${randomUUID()}`;
    pipelines.people.letGo.set(roleKey, "Linus");
    const letGo = await send("POST", "/stage-templates/check", {
      stage: aStage({ role: roleKey }),
    });
    const wider = await send("POST", "/stage-templates/check", {
      stage: aStage({ permissions: { run: "anything" } }),
    });

    expect(pipelineCheckSchema.parse(await letGo.json()).problems).toEqual([
      {
        stageKey: null,
        at: null,
        level: "warning",
        text: `Linus was let go from ${roleKey}; hire Linus back, hire someone else, or choose who works it.`,
      },
    ]);
    expect(pipelineCheckSchema.parse(await wider.json())).toEqual({
      problems: [
        {
          stageKey: null,
          at: null,
          level: "warning",
          text: "The run permission can only be narrowed from the Role card's.",
        },
      ],
    });
  });

  it("doesn't count the template being saved as taking its own name", async () => {
    const template = await added();

    const response = await send("POST", "/stage-templates/check", {
      stage: template.stage,
      stageTemplateId: template.id,
    });

    expect(pipelineCheckSchema.parse(await response.json())).toEqual({
      problems: [],
    });
  });
});
