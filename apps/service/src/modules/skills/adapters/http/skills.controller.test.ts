import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  skillListSchema,
  skillRefusalSchema,
  skillReviewSchema,
  skillSchema,
  skillWebEventSchema,
  type Skill,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  SkillAdded,
  SkillEveryoneChanged,
  SkillRemoved,
  SkillTurnedOn,
  SkillVersionSaved,
} from "../../domain/skill-events.js";
import { SkillsModule } from "../../skills.module.js";
import { aZip } from "../zip/zip.fixtures.js";

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

/** The events published so far, as the web receives them. */
function webEvents(): unknown[] {
  const forwarding = app.get(WebEventForwarding);
  return published.map((event) => {
    const { occurredAt: _occurredAt, ...webEvent } = skillWebEventSchema.parse(
      forwarding.toWebEvent(event),
    );
    return webEvent;
  });
}

/** A name of the test's own, since every test file shares the database. */
function aName(): string {
  return `notes-${randomUUID().slice(0, 8)}`;
}

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

async function reasonsOf(response: Response): Promise<string[]> {
  expect(response.status).toBe(422);
  return skillRefusalSchema.parse(await response.json()).reasons;
}

const skillMd = (name: string) =>
  `---\nname: ${name}\ndescription: Writes release notes.\n---\nGroup them.\n`;

describe("POST /api/skills", () => {
  it("adds a written skill, waiting for review, with its SKILL.md to read", async () => {
    const name = aName();

    const skill = await write(name);

    expect(skill).toMatchObject({
      name,
      description: "Writes release notes.",
      source: "written",
      version: 1,
      state: "waiting-for-review",
      everyone: false,
    });
    const review = await reviewOf(name);
    expect(review.files).toEqual([
      { path: "SKILL.md", text: expect.stringContaining(`name: ${name}`), script: false },
    ]);
    expect(review.instructions).toBe("Group them as Added, Changed and Fixed.");
    expect(published).toEqual([expect.any(SkillAdded)]);
  });

  it("refuses a name the library has", async () => {
    const name = aName();
    await write(name);

    const response = await send("POST", "/skills", {
      name,
      description: "Another.",
      instructions: "x",
    });

    expect(await reasonsOf(response)).toEqual([`The library already has ${name}.`]);
  });

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

  it("adds a zipped folder, flagging its script for review", async () => {
    const name = aName();
    const zip = await aZip([
      { file: `${name}/SKILL.md`, text: "---\ndescription: Writes release notes.\n---\nRun it.\n" },
      { file: `${name}/scripts/collect.sh`, text: "#!/bin/sh\ngit log\n" },
    ]);

    const response = await upload("/skills/uploads", "download.zip", zip);

    expect(response.status).toBe(201);
    expect(skillSchema.parse(await response.json())).toMatchObject({
      name,
      source: "uploaded-folder",
    });
    const review = await reviewOf(name);
    expect(review.files.map(({ path, script }) => ({ path, script }))).toEqual([
      { path: "SKILL.md", script: false },
      { path: "scripts/collect.sh", script: true },
    ]);
    expect(review.warnings).toEqual([
      "It includes a script. Scripts run with the permissions of whoever uses the skill.",
    ]);
  });

  it("refuses a zip holding a link, and keeps nothing of it", async () => {
    const name = aName();
    const zip = await aZip([
      { file: "SKILL.md", text: skillMd(name) },
      { link: "elsewhere", target: "../../.ssh" },
    ]);

    const response = await upload("/skills/uploads", `${name}.zip`, zip);

    expect(await reasonsOf(response)).toEqual([
      `"elsewhere" is a link; a skill holds only its own files.`,
    ]);
    expect((await fetch(`${url}/api/skills/${name}`)).status).toBe(404);
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
  // Marked for everyone while off: a skill on and for everyone would reach the sessions other
  // test files prepare on the shared database, with its files in this test's folder.
  it("marks a skill for everyone, turns it on and removes it", async () => {
    const name = aName();
    await write(name);

    const everyone = await send("PUT", `/skills/${name}/everyone`, { everyone: true });
    expect(skillSchema.parse(await everyone.json()).everyone).toBe(true);
    await send("PUT", `/skills/${name}/everyone`, { everyone: false });
    const on = await send("PUT", `/skills/${name}/state`, { state: "on" });
    expect(skillSchema.parse(await on.json()).state).toBe("on");
    const removed = await send("DELETE", `/skills/${name}`);
    expect(removed.status).toBe(204);

    expect((await fetch(`${url}/api/skills/${name}`)).status).toBe(404);
    expect(published.slice(1)).toEqual([
      expect.any(SkillEveryoneChanged),
      expect.any(SkillEveryoneChanged),
      expect.any(SkillTurnedOn),
      expect.any(SkillRemoved),
    ]);
    expect(webEvents()).toEqual([
      { type: "skill.added", skillName: name },
      { type: "skill.everyone-changed", skillName: name },
      { type: "skill.everyone-changed", skillName: name },
      { type: "skill.turned-on", skillName: name },
      { type: "skill.removed", skillName: name },
    ]);
  });

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

function roleSkillsChanged(roleKey: string): unknown {
  return { type: "skill.role-skills-changed", roleKey };
}

describe("PUT /api/skills/:name/roles", () => {
  it("gives the skill to exactly the Roles named, and lists them with it", async () => {
    const name = aName();
    await write(name);
    const [first, second] = [`role-${randomUUID()}`, `role-${randomUUID()}`];
    await send("PUT", `/skills/${name}/roles`, { roles: [first] });

    const response = await send("PUT", `/skills/${name}/roles`, { roles: [second] });

    expect(skillSchema.parse(await response.json()).roles).toEqual([second]);
    const listed = skillListSchema.parse(await (await fetch(`${url}/api/skills`)).json());
    expect(listed.find((skill) => skill.name === name)?.roles).toEqual([second]);
    // One event per Role whose skills changed, in key order.
    expect(webEvents().slice(1)).toEqual([
      roleSkillsChanged(first),
      ...[first, second].toSorted().map(roleSkillsChanged),
    ]);
  });

  it("answers 404 for a skill the library doesn't have", async () => {
    expect((await send("PUT", "/skills/nowhere/roles", { roles: [] })).status).toBe(404);
  });
});
