import { randomUUID } from "node:crypto";
import {
  RESET_PROMPT_TEMPLATE_ACTION,
  SAVE_PROMPT_TEMPLATE_ACTION,
  promptTemplateRefusalSchema,
  promptTemplateSchema,
} from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { SIGNED_IN_FOR_TESTS } from "../../../../platform/http/signed-in-requests.fixtures.js";
import { anOfficeToolCall, RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import {
  PromptTemplateCatalog,
  PromptTemplateChanged,
  PromptTemplates,
  promptTemplate,
} from "../../../prompt-templates/index.js";
import {
  PromptTemplateRepository,
  PromptTemplateRepositoryForTests,
} from "../../../prompt-templates/index.fixtures.js";
import {
  startPipelinesApplicationWith,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import { SessionPeopleForTests } from "../../ports/pipelines-ports.fixtures.js";

const SESSION = "prompt-session";
const DEFAULT_TEXT = "Work on {{title}}.";

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

/** The app on templates kept in memory, with one template of the test's own registered. */
async function start() {
  pipelines = await startPipelinesApplicationWith(
    [{ provide: PromptTemplateRepository, useValue: new PromptTemplateRepositoryForTests() }],
    [],
  );
  const key = `engine.test-${randomUUID()}`;
  pipelines.app.get(PromptTemplateCatalog).register([
    promptTemplate({
      key,
      domain: "engine",
      name: "A test's Brief",
      description: "Only this test renders it.",
      variables: { title: { kind: "text", description: "The Task's title." } },
      text: DEFAULT_TEXT,
    }),
  ]);
  const url = `${await pipelines.app.getUrl()}/api/settings/prompt-templates`;
  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${url}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { key, send };
}

function callTool(
  name: string,
  input: Record<string, unknown>,
  allowedBy?: { userId: string; name: string },
) {
  const [tool] = pipelines.app.get(OfficeToolRegistry).named([name], RUN_EVERY_CALL);
  if (!tool) throw new Error(`No Office tool ${name}.`);
  return tool.run(input, { ...anOfficeToolCall(SESSION), ...(allowedBy && { allowedBy }) });
}

function changedEvents(key: string) {
  return pipelines.published.filter(
    (event) => event instanceof PromptTemplateChanged && event.key === key,
  );
}

describe("the Prompt template actions", () => {
  it("save and reset through the route and the tool alike, recording the user", async () => {
    const { key, send } = await start();
    pipelines.app.get(SessionPeopleForTests).asked = { userId: "user-ann", name: "Ann Lee" };

    const saved = await send("PUT", `/${key}`, { text: "Do {{title}}." });
    expect(saved.status).toBe(200);
    expect(promptTemplateSchema.parse(await saved.json())).toMatchObject({
      text: "Do {{title}}.",
      customised: true,
      version: 1,
      savedBy: { userId: SIGNED_IN_FOR_TESTS.userId, name: SIGNED_IN_FOR_TESTS.name },
    });

    const byTool = await callTool(SAVE_PROMPT_TEMPLATE_ACTION.name, {
      key,
      text: "Again {{title}}.",
    });
    expect(byTool.isError).toBe(false);
    const state = await pipelines.app.get(PromptTemplates).read(key);
    expect(state).toMatchObject({ text: "Again {{title}}." });
    expect(state.saved).toMatchObject({
      version: 2,
      savedBy: { userId: "user-ann", name: "Ann Lee" },
    });

    const allowed = await callTool(
      RESET_PROMPT_TEMPLATE_ACTION.name,
      { key },
      { userId: "user-bo", name: "Bo Ray" },
    );
    expect(allowed.isError).toBe(false);
    expect((await pipelines.app.get(PromptTemplates).read(key)).saved).toMatchObject({
      version: 3,
      text: null,
      savedBy: { userId: "user-bo", name: "Bo Ray" },
    });
    const reset = await send("DELETE", `/${key}`);
    expect(reset.status).toBe(200);
    expect(promptTemplateSchema.parse(await reset.json())).toMatchObject({
      text: DEFAULT_TEXT,
      customised: false,
      version: 3,
    });
  });

  it("announces a change once for each save or reset that changed the text", async () => {
    const { key, send } = await start();
    pipelines.published.length = 0;

    await send("PUT", `/${key}`, { text: "Do {{title}}." });
    await send("PUT", `/${key}`, { text: "Do {{title}}." });
    await send("DELETE", `/${key}`);
    await send("DELETE", `/${key}`);

    expect(changedEvents(key)).toHaveLength(2);
  });

  it("refuse a text with every problem, and a key nobody registered, as the route and the tool do", async () => {
    const { key, send } = await start();
    pipelines.app.get(SessionPeopleForTests).asked = { userId: "user-ann", name: "Ann Lee" };
    pipelines.published.length = 0;

    const route = await send("PUT", `/${key}`, { text: "Do {{task}}." });
    const tool = await callTool(SAVE_PROMPT_TEMPLATE_ACTION.name, { key, text: "Do {{task}}." });

    expect(route.status).toBe(422);
    const refusal = promptTemplateRefusalSchema.parse(await route.json());
    expect(refusal).toMatchObject({
      reasons: [expect.stringMatching(/^Line 1, column 4: /)],
      problems: [{ line: 1, column: 4 }],
    });
    expect(tool).toEqual({ text: refusal.message, isError: true });
    expect(changedEvents(key)).toEqual([]);
    expect((await send("PUT", "/engine.unknown", { text: "" })).status).toBe(404);
    expect(
      await callTool(RESET_PROMPT_TEMPLATE_ACTION.name, { key: "engine.unknown" }),
    ).toMatchObject({ isError: true });
  });

  it("refuse an Agent's call that no user stands behind", async () => {
    const { key } = await start();

    const result = await callTool(SAVE_PROMPT_TEMPLATE_ACTION.name, { key, text: "Do {{title}}." });

    expect(result).toEqual({
      text: "The Office doesn't know which user asked for this.",
      isError: true,
    });
  });

  it("draft the text as a diff, fingerprinted by the newest saved version", async () => {
    const { key } = await start();
    const registry = pipelines.app.get(OfficeToolRegistry);
    const templates = pipelines.app.get(PromptTemplates);
    const input = { key, text: "Do {{title}}.\nThen rest." };

    const before = await registry.draft(SAVE_PROMPT_TEMPLATE_ACTION.name, input);
    expect(before).toMatchObject({
      subject: { kind: "prompt-template", id: key, title: "A test's Brief" },
      fields: [{ label: "Text", before: DEFAULT_TEXT, after: input.text, form: "long" }],
    });
    expect((await registry.draft(SAVE_PROMPT_TEMPLATE_ACTION.name, input))?.fingerprint).toBe(
      before?.fingerprint,
    );

    await templates.save(key, "Saved since {{title}}.", {
      userId: "user-bo",
      name: "Bo Ray",
    });

    const after = await registry.draft(SAVE_PROMPT_TEMPLATE_ACTION.name, input);
    expect(after?.fingerprint).not.toBe(before?.fingerprint);
    expect(after?.fields[0]).toMatchObject({ before: "Saved since {{title}}." });
  });

  it("draft a reset to the default and apply a Proposal as the user who applies it", async () => {
    const { key } = await start();
    const registry = pipelines.app.get(OfficeToolRegistry);
    const templates = pipelines.app.get(PromptTemplates);
    const ann = { userId: "user-ann", name: "Ann Lee" };
    await templates.save(key, "Custom {{title}}.", ann);

    const drafted = await registry.draft(RESET_PROMPT_TEMPLATE_ACTION.name, { key });
    await registry.applyFor(
      RESET_PROMPT_TEMPLATE_ACTION.name,
      { key },
      { user: { userId: "user-cy", name: "Cy Dee" }, proposedBy: "cto" },
    );

    expect(drafted?.fields).toEqual([
      expect.objectContaining({ label: "Text", before: "Custom {{title}}.", after: DEFAULT_TEXT }),
    ]);
    expect((await templates.read(key)).saved).toMatchObject({
      version: 2,
      text: null,
      savedBy: { userId: "user-cy", name: "Cy Dee" },
    });
  });
});
