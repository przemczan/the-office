import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  dutyListSchema,
  dutySchema,
  presetListSchema,
  roleRefusalSchema,
  roleSchema,
  roleWebEventSchema,
} from "@the-office/contracts";
import { inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { DutyRepository } from "../../ports/duty-repository.js";
import { DutyRepositoryForTests } from "../../ports/duty-repository.fixtures.js";
import { PeopleModule } from "../../people.module.js";
import { roles } from "../postgres/roles.schema.js";

// The duties are kept in memory: every test file shares the database, and a stored duty would
// change who every other file's sessions consult. The Roles are the test's own, hired from scratch
// (apps/service/docs/testing.md), and removed after each test.
let officeData: string;
let app: INestApplication;
let url: string;
let published: DomainEvent[];
let hiredKeys: string[];

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-duties-"));
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      PeopleModule,
    ],
    overrides: [{ provide: DutyRepository, useValue: new DutyRepositoryForTests() }],
  }));
  published = [];
  hiredKeys = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await app.get<Database>(DATABASE).delete(roles).where(inArray(roles.key, hiredKeys));
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

function send(method: "POST" | "PUT", path: string, body: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function get(path: string): Promise<unknown> {
  const response = await fetch(`${url}/api${path}`);
  expect(response.status).toBe(200);
  return response.json();
}

/** Hires a person from scratch into a Role of the test's own, keyed from a title of its own. */
async function hireOwn(name: string): Promise<{ key: string; title: string }> {
  const [developer] = presetListSchema.parse(await get("/presets")).slice(1, 2);
  if (!developer) throw new Error("The Developer preset is missing.");
  const title = `Lead ${randomUUID().slice(0, 8)}`;
  const response = await send("POST", "/roles", {
    card: { ...developer.card, name, title, skills: [] },
  });
  expect(response.status).toBe(201);
  const { key } = roleSchema.parse(await response.json());
  hiredKeys.push(key);
  return { key, title };
}

async function reasonsOf(response: Response): Promise<string[]> {
  expect(response.status).toBe(422);
  return roleRefusalSchema.parse(await response.json()).reasons;
}

describe("GET /api/settings/duties", () => {
  it("lists all eight duties, each at its default Role key while never set", async () => {
    const duties = dutyListSchema.parse(await get("/settings/duties"));

    expect(
      duties.map(({ key, defaultRoleKey, set, roleKey }) => [key, defaultRoleKey, set, roleKey]),
    ).toEqual([
      ["default-person-to-talk-to", "office-manager", false, "office-manager"],
      ["shapes-initiatives", "cto", false, "cto"],
      ["asked-first-when-out-of-tries", "cto", false, "cto"],
      ["onboards-projects", "devops", false, "devops"],
      ["mcp-tool-consultant", "devops", false, "devops"],
      ["plans", "planner", false, "planner"],
      ["implements", "developer", false, "developer"],
      ["reviews", "reviewer", false, "reviewer"],
    ]);
    expect(duties[0]?.label).toBe("Default person to talk to");
  });
});

describe("the duties' job settings", () => {
  it("lists each duty's job and, while it is held, what the holder's card leaves Never of it", async () => {
    const { key } = await hireOwn("Quin");
    await send("PUT", "/settings/duties/onboards-projects", { roleKey: key });

    const duties = dutyListSchema.parse(await get("/settings/duties"));

    const onboards = duties.find(({ key: duty }) => duty === "onboards-projects");
    expect(onboards?.jobSettings).toMatchObject({
      projectUpkeep: { kind: "allowed" },
      changeProjectSettings: { kind: "proposal" },
    });
    // A Role from scratch has Publishing settings at Never.
    expect(onboards?.jobSettingsToGive).toEqual({
      publishingSettings: { kind: "proposal" },
    });
    expect(duties.find(({ key: duty }) => duty === "implements")?.jobSettings).toEqual({});
  });

  it("answers null for a duty nobody holds", async () => {
    await send("PUT", "/settings/duties/onboards-projects", { roleKey: null });

    const duties = dutyListSchema.parse(await get("/settings/duties"));

    expect(duties.find(({ key }) => key === "onboards-projects")?.jobSettingsToGive).toBeNull();
  });
});

describe("PUT /api/settings/duties/:duty", () => {
  it("gives a duty to a hired Role, which the list shows and the web hears of", async () => {
    const { key, title } = await hireOwn("Lea");
    published = [];

    const response = await send("PUT", "/settings/duties/plans", { roleKey: key });

    expect(response.status).toBe(200);
    const holding = { set: true, roleKey: key, holder: { roleKey: key, name: "Lea", title } };
    expect(dutySchema.parse(await response.json())).toMatchObject({ ...holding, fallback: null });
    const listed = dutyListSchema.parse(await get("/settings/duties"));
    expect(listed.find((duty) => duty.key === "plans")).toMatchObject(holding);
    const forwarding = app.get(WebEventForwarding);
    const webEvents = published.map((event) =>
      roleWebEventSchema.parse(forwarding.toWebEvent(event)),
    );
    expect(webEvents).toEqual([expect.objectContaining({ type: "duty.changed", duty: "plans" })]);
  });

  it("sets a duty to none, naming its fallback", async () => {
    const response = await send("PUT", "/settings/duties/default-person-to-talk-to", {
      roleKey: null,
    });

    expect(dutySchema.parse(await response.json())).toMatchObject({
      set: true,
      roleKey: null,
      holder: null,
      fallback: "caretaker",
    });
  });

  it("refuses a Role not hired, a let-go Role and the Caretaker, with the reason", async () => {
    const { key } = await hireOwn("Rui");
    expect((await send("POST", `/roles/${key}/let-go`, {})).status).toBe(201);

    expect(
      await reasonsOf(await send("PUT", "/settings/duties/plans", { roleKey: "nobody" })),
    ).toEqual(['Plans goes to a hired Role, and nobody is hired as "nobody".']);
    expect(await reasonsOf(await send("PUT", "/settings/duties/plans", { roleKey: key }))).toEqual([
      `Plans goes to a hired Role, and nobody is hired as "${key}".`,
    ]);
    expect(
      await reasonsOf(await send("PUT", "/settings/duties/plans", { roleKey: "caretaker" })),
    ).toEqual(["The Caretaker is built in and holds no duty, so not Plans."]);
    const plans = dutyListSchema
      .parse(await get("/settings/duties"))
      .find((duty) => duty.key === "plans");
    expect(plans?.set).toBe(false);
  });

  it("answers 404 for a duty The Office doesn't have", async () => {
    const response = await send("PUT", "/settings/duties/sweeps-floors", { roleKey: null });

    expect(response.status).toBe(404);
  });
});
