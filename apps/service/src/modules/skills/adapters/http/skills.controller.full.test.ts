import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { skillListSchema, skillReviewSchema, skillSchema, type Skill } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { SkillVersionSaved } from "../../domain/skill-events.js";
import { SkillsModule } from "../../skills.module.js";
import { aName, reasonsOf, skillMd } from "./skills.controller.fixtures.js";

let officeData: string;
let app: INestApplication;
let url: string;
let published: DomainEvent[];

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-skills-"));
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [EventsModule, EventStreamModule, OfficeDataModule.forRoot(officeData), SkillsModule],
  }));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

function send(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function upload(path: string, fileName: string, content: Uint8Array | string): Promise<Response> {
  return fetch(`${url}/api${path}?fileName=${encodeURIComponent(fileName)}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: typeof content === "string" ? content : Buffer.from(content),
  });
}

async function write(name: string): Promise<Skill> {
  const response = await send("POST", "/skills", {
    name,
    description: "Writes release notes.",
    instructions: "Group them as Added, Changed and Fixed.",
  });
  expect(response.status).toBe(201);
  return skillSchema.parse(await response.json());
}

async function reviewOf(name: string) {
  const response = await fetch(`${url}/api/skills/${name}/review`);
  expect(response.status).toBe(200);
  return skillReviewSchema.parse(await response.json());
}

describe("POST /api/skills", () => {
  it("refuses with every reason", async () => {
    const response = await send("POST", "/skills", { name: "", description: "", instructions: "" });

    expect(await reasonsOf(response)).toEqual([
      "Give the skill a name.",
      "Give the skill a description: when to use it, in one sentence.",
      "Give the skill its instructions.",
    ]);
  });
});

describe("POST /api/skills/uploads", () => {
  it("adds a single .md as the skill's SKILL.md", async () => {
    const name = aName();

    const response = await upload("/skills/uploads", "anything.md", skillMd(name));

    expect(response.status).toBe(201);
    expect(skillSchema.parse(await response.json())).toMatchObject({
      name,
      source: "uploaded-file",
      state: "waiting-for-review",
    });
  });

  it("refuses a file that is no .md or zip", async () => {
    const response = await upload("/skills/uploads", "notes.txt", "Notes.");

    expect(await reasonsOf(response)).toEqual(["Upload a single .md file or a zipped folder."]);
  });

  it("answers 400 for a body that is no file", async () => {
    const response = await fetch(`${url}/api/skills/uploads?fileName=notes.md`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(400);
  });

  it("answers 413 for an upload larger than the library takes", async () => {
    const response = await upload("/skills/uploads", "big.md", "x".repeat(10 * 1024 * 1024 + 1));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ message: "An upload may be at most 10 MB." });
  });
});

describe("a skill's versions", () => {
  it("edits a written skill into its next version, back to review", async () => {
    const name = aName();
    await write(name);
    await send("PUT", `/skills/${name}/state`, { state: "on" });

    const response = await send("PUT", `/skills/${name}`, {
      description: "Writes the release notes.",
      instructions: "One line each.",
    });

    expect(response.status).toBe(200);
    expect(skillSchema.parse(await response.json())).toMatchObject({
      version: 2,
      description: "Writes the release notes.",
      state: "waiting-for-review",
    });
    expect((await reviewOf(name)).instructions).toBe("One line each.");
    expect(published.at(-1)).toBeInstanceOf(SkillVersionSaved);
  });

  it("uploads the next version of an uploaded skill", async () => {
    const name = aName();
    await upload("/skills/uploads", `${name}.md`, skillMd(name));

    const response = await upload(
      `/skills/${name}/versions`,
      "notes.md",
      `${skillMd(name)}\nAnd one more line.\n`,
    );

    expect(response.status).toBe(201);
    expect(skillSchema.parse(await response.json())).toMatchObject({ version: 2 });
  });

  it("refuses an upload that names another skill as its next version", async () => {
    const name = aName();
    await upload("/skills/uploads", `${name}.md`, skillMd(name));

    const response = await upload(`/skills/${name}/versions`, "x.md", skillMd("other"));

    expect(await reasonsOf(response)).toEqual([`It names the skill other, not ${name}.`]);
  });

  it("refuses to edit an uploaded skill in place", async () => {
    const name = aName();
    await upload("/skills/uploads", `${name}.md`, skillMd(name));

    const response = await send("PUT", `/skills/${name}`, { description: "x", instructions: "y" });

    expect(await reasonsOf(response)).toEqual([
      `${name} was uploaded; upload a new version of it instead.`,
    ]);
  });
});

describe("turning a skill on, for everyone, and removing it", () => {
  it("lists the library", async () => {
    const name = aName();
    await write(name);

    const response = await fetch(`${url}/api/skills`);

    expect(skillListSchema.parse(await response.json()).map((skill) => skill.name)).toContain(name);
  });

  it("answers 404 for a skill the library doesn't have", async () => {
    expect((await send("PUT", "/skills/nowhere/state", { state: "on" })).status).toBe(404);
  });
});

describe("PUT /api/skills/:name/roles", () => {
  it("answers 404 for a skill the library doesn't have", async () => {
    expect((await send("PUT", "/skills/nowhere/roles", { roles: [] })).status).toBe(404);
  });
});
