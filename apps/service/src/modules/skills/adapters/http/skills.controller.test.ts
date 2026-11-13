import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  skillListSchema,
  skillReviewSchema,
  skillSchema,
  skillWebEventSchema,
  type Skill,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { SkillCalled } from "../../../engine/index.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  ANOTHER_SIGNED_IN_FOR_TESTS,
  signedInAs,
} from "../../../../platform/http/signed-in-requests.fixtures.js";
import {
  SkillAdded,
  SkillEveryoneChanged,
  SkillRemoved,
  SkillTurnedOn,
  SkillUsed,
} from "../../domain/skill-events.js";
import { SkillsModule } from "../../skills.module.js";
import { RoleSkills } from "../../application/role-skills.js";
import { ANN_LEE, BEN_ITO } from "../../domain/user.fixtures.js";
import { SessionSkillRepository } from "../../ports/session-skill-repository.js";
import { aRecord } from "../postgres/postgres-session-skill-repository.fixtures.js";
import { aZip } from "../zip/zip.fixtures.js";
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

function send(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
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
});

describe("POST /api/skills/uploads", () => {
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

  it("keeps the signed-in user who changed each Role's skills", async () => {
    const name = aName();
    await write(name);
    const roleKey = `role-${randomUUID()}`;
    await send("PUT", `/skills/${name}/roles`, { roles: [roleKey] });
    await send(
      "PUT",
      `/skills/${name}/roles`,
      { roles: [] },
      signedInAs(ANOTHER_SIGNED_IN_FOR_TESTS),
    );

    const changes = await app.get(RoleSkills).changes(roleKey);

    expect(changes.map(({ added, removed, changedBy }) => ({ added, removed, changedBy }))).toEqual(
      [
        { added: [], removed: [name], changedBy: BEN_ITO },
        { added: [name], removed: [], changedBy: ANN_LEE },
      ],
    );
  });
});

describe("GET /api/skills", () => {
  it("gives each skill its uses in the last 7 days, each use announced to the web", async () => {
    const skill = await write(aName());
    const session = aRecord({
      skills: [{ name: skill.name, version: skill.version, filesHash: skill.filesHash }],
    });
    await app.get(SessionSkillRepository).add(session);

    const called = (name: string) =>
      app
        .get(EventBus)
        .publish(new SkillCalled(session.sessionId, "claude-code", name, new Date()));
    await called(`office:${skill.name}`);
    await called(skill.name);
    await called("init");

    const listed = skillListSchema.parse(await (await fetch(`${url}/api/skills`)).json());
    expect(listed.find(({ name }) => name === skill.name)?.usesInLast7Days).toBe(2);
    const forwarding = app.get(WebEventForwarding);
    const used = published.filter((event) => event instanceof SkillUsed);
    expect(used.map((event) => forwarding.toWebEvent(event))).toEqual([
      expect.objectContaining({
        type: "skill.used",
        skill: { kind: "library", skillName: skill.name },
      }),
      expect.objectContaining({
        type: "skill.used",
        skill: { kind: "library", skillName: skill.name },
      }),
    ]);
  });
});
