import { randomUUID } from "node:crypto";
import { Injectable, Module, type INestApplication, type OnModuleInit } from "@nestjs/common";
import {
  PROMPT_TEMPLATE_MAX_CHARACTERS,
  promptTemplateCheckSchema,
  promptTemplateListSchema,
  promptTemplateRefusalSchema,
  promptTemplateSchema,
  promptTemplateWebEventSchema,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { SIGNED_IN_FOR_TESTS } from "../../../../platform/http/signed-in-requests.fixtures.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { PromptTemplateCatalog } from "../../application/prompt-template-catalog.js";
import { promptTemplate } from "../../domain/prompt-template.js";
import { PROMPT_TEXT_MAX_CHARACTERS } from "../../domain/prompt-text-problems.js";
import { PromptTemplateRepository } from "../../ports/prompt-template-repository.js";
import { PromptTemplatesModule } from "../../prompt-templates.module.js";

/** A template of the test's own, as every test file shares the table. */
const TEMPLATE = promptTemplate({
  key: `engine.test-${randomUUID()}`,
  domain: "engine",
  name: "A test's Brief",
  description: "Only this test renders it.",
  variables: {
    title: { kind: "text", description: "The Task's title." },
    stages: { kind: "list", description: "The Stages.", fields: { name: "The Stage's name." } },
  },
  text: "Work on {{title}}.",
});

@Injectable()
class TestPromptTemplates implements OnModuleInit {
  constructor(private readonly catalog: PromptTemplateCatalog) {}

  onModuleInit(): void {
    this.catalog.register([TEMPLATE]);
  }
}

@Module({ imports: [PromptTemplatesModule], providers: [TestPromptTemplates] })
class TestTemplatesModule {}

let app: INestApplication;
let url: string;
let published: DomainEvent[];

beforeAll(async () => {
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [EventsModule, EventStreamModule, PromptTemplatesModule, TestTemplatesModule],
  }));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterAll(async () => {
  await app.close();
});

/** The events published so far, as the web receives them. */
function webEvents(): unknown[] {
  const forwarding = app.get(WebEventForwarding);
  return published.map((event) => {
    const { occurredAt: _occurredAt, ...webEvent } = promptTemplateWebEventSchema.parse(
      forwarding.toWebEvent(event),
    );
    return webEvent;
  });
}

/** A template of its own for one test, registered after the app started. */
function aTemplateOfItsOwn(text: string): string {
  const key = `engine.test-${randomUUID()}`;
  app.get(PromptTemplateCatalog).register([
    promptTemplate({
      key,
      domain: "engine",
      name: "Another test's Brief",
      description: "Only this test renders it.",
      variables: { title: { kind: "text", description: "The Task's title." } },
      text,
    }),
  ]);
  return key;
}

function send(method: "PUT" | "POST" | "DELETE", path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api/settings/prompt-templates${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/settings/prompt-templates", () => {
  it("lists, reads, checks, saves, refuses and resets a template", async () => {
    const list = promptTemplateListSchema.parse(
      await (await fetch(`${url}/api/settings/prompt-templates?domain=engine`)).json(),
    );
    expect(list.find(({ key }) => key === TEMPLATE.key)).toEqual({
      key: TEMPLATE.key,
      domain: "engine",
      name: "A test's Brief",
      description: "Only this test renders it.",
      customised: false,
      hasProblems: false,
      version: 0,
      savedAt: null,
      savedBy: null,
    });

    const read = await fetch(`${url}/api/settings/prompt-templates/${TEMPLATE.key}`);
    expect(promptTemplateSchema.parse(await read.json())).toMatchObject({
      text: TEMPLATE.text,
      defaultText: TEMPLATE.text,
      variables: [
        { name: "title", description: "The Task's title.", kind: "text" },
        {
          name: "stages",
          kind: "list",
          fields: [{ name: "name", description: "The Stage's name." }],
        },
      ],
      problems: [],
    });

    const check = await send("POST", `/${TEMPLATE.key}/check`, { text: "{{#stages}}{{name}}" });
    expect(check.status).toBe(200);
    expect(promptTemplateCheckSchema.parse(await check.json()).problems).toEqual([
      { message: "{{#stages}} is never closed with {{/stages}}.", line: 1, column: 1 },
    ]);

    const saved = await send("PUT", `/${TEMPLATE.key}`, { text: "Do {{title}}." });
    expect(saved.status).toBe(200);
    expect(promptTemplateSchema.parse(await saved.json())).toMatchObject({
      text: "Do {{title}}.",
      customised: true,
      version: 1,
      savedBy: { userId: SIGNED_IN_FOR_TESTS.userId, name: SIGNED_IN_FOR_TESTS.name },
    });

    const refused = await send("PUT", `/${TEMPLATE.key}`, { text: "Do {{task}}." });
    expect(refused.status).toBe(422);
    expect(promptTemplateRefusalSchema.parse(await refused.json())).toMatchObject({
      reasons: [expect.stringMatching(/^Line 1, column 4: /)],
      problems: [{ line: 1, column: 4 }],
    });

    const reset = await send("DELETE", `/${TEMPLATE.key}`);
    expect(reset.status).toBe(200);
    expect(promptTemplateSchema.parse(await reset.json())).toMatchObject({
      text: TEMPLATE.text,
      customised: false,
      version: 2,
    });
  });

  it("announces prompt-template.changed once for each save or reset that changed the text", async () => {
    const key = aTemplateOfItsOwn("Work on {{title}}.");
    published.length = 0;

    await send("PUT", `/${key}`, { text: "Do {{title}}." });
    await send("PUT", `/${key}`, { text: "Do {{title}}." });
    expect(webEvents()).toEqual([{ type: "prompt-template.changed", key }]);

    published.length = 0;
    await send("DELETE", `/${key}`);
    await send("DELETE", `/${key}`);
    expect(webEvents()).toEqual([{ type: "prompt-template.changed", key }]);
  });

  it("announces nothing for a refused save", async () => {
    const key = aTemplateOfItsOwn("Work on {{title}}.");
    published.length = 0;

    expect((await send("PUT", `/${key}`, { text: "Do {{task}}." })).status).toBe(422);

    expect(published).toEqual([]);
  });

  it("lists a template whose saved text no longer passes the check with hasProblems", async () => {
    const key = aTemplateOfItsOwn("Work on {{title}}.");
    // As after a release removed a variable: the stored text names one the template lacks.
    await app
      .get(PromptTemplateRepository)
      .update(
        key,
        (current) => ({ version: (current?.version ?? 0) + 1, text: "Do {{removed}}." }),
        new Date(),
        { userId: SIGNED_IN_FOR_TESTS.userId, name: SIGNED_IN_FOR_TESTS.name },
      );

    const list = promptTemplateListSchema.parse(
      await (await fetch(`${url}/api/settings/prompt-templates`)).json(),
    );
    expect(list.find((summary) => summary.key === key)).toMatchObject({
      customised: true,
      hasProblems: true,
    });
    const read = promptTemplateSchema.parse(
      await (await fetch(`${url}/api/settings/prompt-templates/${key}`)).json(),
    );
    expect(read.problems).toEqual([expect.objectContaining({ line: 1, column: 4 })]);
  });

  it("answers 404 for a key no module registered", async () => {
    expect((await fetch(`${url}/api/settings/prompt-templates/engine.unknown`)).status).toBe(404);
    expect((await send("PUT", "/engine.unknown", { text: "" })).status).toBe(404);
  });

  it("limits a text's length as the contract does", () => {
    expect(PROMPT_TEXT_MAX_CHARACTERS).toBe(PROMPT_TEMPLATE_MAX_CHARACTERS);
  });
});
