import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { promptTemplate } from "../domain/prompt-template.js";
import { PromptTemplateChanged } from "../domain/prompt-template-events.js";
import { A_TEMPLATE } from "../domain/prompt-template.fixtures.js";
import { PromptTemplateNotFound } from "../domain/prompt-template-not-found.js";
import { PromptTemplateRefused } from "../domain/prompt-template-refused.js";
import { PromptTemplateRepositoryForTests } from "../ports/prompt-template-repository.fixtures.js";
import { PromptTemplateCatalog } from "./prompt-template-catalog.js";
import { PromptTemplates } from "./prompt-templates.js";

const ANN = { userId: "00000000-0000-4000-8000-0000000005e1", name: "Ann Lee" };
const BEN = { userId: "00000000-0000-4000-8000-0000000005e2", name: "Ben Ito" };
const VALUES = { title: "Rename a device", urgent: false, files: [], stages: [] };

let catalog: PromptTemplateCatalog;
let repository: PromptTemplateRepositoryForTests;
let templates: PromptTemplates;
let published: DomainEvent[];

beforeEach(() => {
  catalog = new PromptTemplateCatalog();
  catalog.register([A_TEMPLATE]);
  repository = new PromptTemplateRepositoryForTests();
  const events = new EventBus();
  published = [];
  events.subscribeToEveryEvent((event) => void published.push(event));
  templates = new PromptTemplates(catalog, repository, events);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function rendered(): Promise<string> {
  return (await templates.textsOf([A_TEMPLATE])).render(A_TEMPLATE, VALUES);
}

describe("the catalog", () => {
  it("refuses a duplicate key, a key outside its domain and a default that fails the check", () => {
    expect(() => catalog.register([A_TEMPLATE])).toThrow(
      "The prompt template pipelines.a-brief can't be registered: a template with this key is registered already.",
    );
    expect(() => catalog.register([{ ...A_TEMPLATE, key: "work.a-brief" }])).toThrow(
      'its key must be "pipelines." followed by a name in kebab-case.',
    );
    expect(() =>
      catalog.register([
        promptTemplate({ ...A_TEMPLATE, key: "pipelines.broken", text: "{{#x}}" }),
      ]),
    ).toThrow("its default text fails the check, line 1, column 1:");
  });

  it("lists by domain and refuses an unknown key", () => {
    expect(catalog.byDomain("pipelines")).toEqual([A_TEMPLATE]);
    expect(catalog.byDomain("work")).toEqual([]);
    expect(() => catalog.get("pipelines.unknown")).toThrow(PromptTemplateNotFound);
  });
});

describe("Prompt templates", () => {
  it("render the default until a text is saved, then the saved one, and the default again after a reset", async () => {
    expect(await rendered()).toBe("Work on Rename a device.");

    const saved = await templates.save(A_TEMPLATE.key, "Do {{title}} now.", ANN);

    expect(saved).toMatchObject({
      customised: true,
      text: "Do {{title}} now.",
      saved: { version: 1, savedBy: ANN },
    });
    expect(await rendered()).toBe("Do Rename a device now.");

    const reset = await templates.resetToDefault(A_TEMPLATE.key, BEN);

    expect(reset).toMatchObject({
      customised: false,
      text: A_TEMPLATE.text,
      saved: { version: 2, text: null, savedBy: BEN },
    });
    expect(await rendered()).toBe("Work on Rename a device.");
    expect(published).toEqual([
      expect.any(PromptTemplateChanged),
      expect.any(PromptTemplateChanged),
    ]);
    expect(published).toMatchObject([
      { key: A_TEMPLATE.key, version: 1 },
      { key: A_TEMPLATE.key, version: 2 },
    ]);
  });

  it("keep no new version for the current text again, nor for the default while it renders", async () => {
    await templates.save(A_TEMPLATE.key, A_TEMPLATE.text, ANN);
    await templates.resetToDefault(A_TEMPLATE.key, ANN);
    await templates.save(A_TEMPLATE.key, "Do {{title}}.", ANN);
    const again = await templates.save(A_TEMPLATE.key, "Do {{title}}.", BEN);

    expect(again.saved).toMatchObject({ version: 1, savedBy: ANN });
    expect(published).toHaveLength(1);
  });

  it("refuse a text that fails the check, saving nothing, with each problem where it is", async () => {
    const refusal = templates.save(A_TEMPLATE.key, "Do {{task}}.", ANN);

    await expect(refusal).rejects.toBeInstanceOf(PromptTemplateRefused);
    await expect(refusal).rejects.toMatchObject({
      reasons: [expect.stringMatching(/^Line 1, column 4: \{\{task\}\} isn't a variable/)],
      problems: [{ line: 1, column: 4 }],
    });
    expect((await templates.read(A_TEMPLATE.key)).saved).toBeUndefined();
  });

  it("render the default, with a warning, while the saved text no longer passes the check", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    // As a release that removed a variable the saved text uses leaves it.
    await repository.update(
      A_TEMPLATE.key,
      () => ({ version: 1, text: "Do {{removed}}." }),
      new Date(),
      ANN,
    );

    expect(await rendered()).toBe("Work on Rename a device.");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("pipelines.a-brief no longer passes"),
    );
    expect(await templates.read(A_TEMPLATE.key)).toMatchObject({
      text: "Do {{removed}}.",
      problems: [{ line: 1, column: 4 }],
    });
  });

  it("replace the text a Proposal was drafted from, and refuse once it changed since", async () => {
    await templates.replace(A_TEMPLATE.key, A_TEMPLATE.text, "Do {{title}}.", ANN);

    await expect(
      templates.replace(A_TEMPLATE.key, A_TEMPLATE.text, "Then {{title}}.", BEN),
    ).rejects.toThrow("changed after this was drafted");
    expect((await templates.read(A_TEMPLATE.key)).text).toBe("Do {{title}}.");
  });

  it("load only registered templates", async () => {
    await expect(
      templates.textsOf([{ ...A_TEMPLATE, key: "pipelines.unregistered" }]),
    ).rejects.toThrow(PromptTemplateNotFound);
  });
});
