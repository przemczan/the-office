import type { INestApplication } from "@nestjs/common";
import {
  presetListSchema,
  roleCardOptionsSchema,
  roleCardVersionListSchema,
  roleListSchema,
  roleRefusalSchema,
  roleSchema,
  roleWebEventSchema,
  type Role,
  type RoleCardEdit,
} from "@the-office/contracts";
import { inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { PRESETS } from "../../domain/presets.js";
import { PeopleModule } from "../../people.module.js";
import { roles } from "../postgres/roles.schema.js";

// The only test file that hires from the presets: their Roles' keys are fixed, and every test
// file shares the database, so it removes them before each test (apps/service/README.md).
const PRESET_KEYS = PRESETS.map((preset) => preset.roleKey);

let app: INestApplication;
let url: string;
let published: DomainEvent[];

beforeEach(async () => {
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [EventsModule, EventStreamModule, PeopleModule],
  }));
  await app.get<Database>(DATABASE).delete(roles).where(inArray(roles.key, PRESET_KEYS));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await app.close();
});

/** The events published so far, as the web receives them. */
function webEvents(): unknown[] {
  const forwarding = app.get(WebEventForwarding);
  return published.map((event) => {
    const { occurredAt: _occurredAt, ...webEvent } = roleWebEventSchema.parse(
      forwarding.toWebEvent(event),
    );
    return webEvent;
  });
}

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

async function hire(roleKey: string, name: string): Promise<Role> {
  const response = await send("POST", "/roles", { roleKey, name });
  expect(response.status).toBe(201);
  return roleSchema.parse(await response.json());
}

async function reasonsOf(response: Response): Promise<string[]> {
  expect(response.status).toBe(422);
  return roleRefusalSchema.parse(await response.json()).reasons;
}

function editOf({ card }: Role): RoleCardEdit {
  const { permissionProfile: _permissionProfile, ...edit } = card;
  return edit;
}

describe("GET /api/presets", () => {
  it("lists the Planner, the Developer and the Reviewer with their cards", async () => {
    const presets = presetListSchema.parse(await get("/presets"));

    expect(presets.map(({ roleKey, suggestedName }) => ({ roleKey, suggestedName }))).toEqual([
      { roleKey: "planner", suggestedName: "Jan" },
      { roleKey: "developer", suggestedName: "Ada" },
      { roleKey: "reviewer", suggestedName: "Ola" },
    ]);
    expect(presets[1]?.card).toMatchObject({ title: "Developer", taskLimit: 3 });
  });
});

describe("GET /api/role-card-options", () => {
  it("offers the engine's models, the known Roles and how each switch is seen to", async () => {
    const options = roleCardOptionsSchema.parse(await get("/role-card-options"));

    expect(options.engines).toEqual([
      { engine: "agent-sdk", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
    ]);
    expect(options.knownRoles).toContainEqual({ key: "devops", title: "Devops" });
    expect(options.hardSwitches).toEqual([
      { key: "runInstalls", enforcement: "followed" },
      { key: "publishOutsideThePipeline", enforcement: "followed" },
      { key: "changeRoles", enforcement: "enforced" },
    ]);
    expect(options.taskLimits).toEqual({ lowest: 1, highest: 6 });
  });
});

describe("POST /api/roles", () => {
  it("hires a named person with the preset's card, and announces it", async () => {
    const role = await hire("developer", "Ada");

    expect(role).toMatchObject({
      key: "developer",
      cardVersion: 1,
      card: {
        name: "Ada",
        title: "Developer",
        taskLimit: 3,
        hardSwitches: {
          runInstalls: { kind: "consult", role: "devops" },
          publishOutsideThePipeline: { kind: "consult", role: "cto" },
          changeRoles: { kind: "never" },
        },
      },
      askingYouUntilHired: ["runInstalls", "publishOutsideThePipeline"],
    });
    expect(webEvents()).toEqual([{ type: "role.hired", roleKey: "developer" }]);
  });

  it("refuses a Role someone already fills, with every reason", async () => {
    await hire("planner", "Jan");

    const response = await send("POST", "/roles", { roleKey: "planner", name: " " });

    expect(await reasonsOf(response)).toEqual([
      "Give the person a name.",
      "Jan already fills the Planner Role.",
    ]);
  });

  it("refuses one of two hires into a Role at once", async () => {
    const responses = await Promise.all([
      send("POST", "/roles", { roleKey: "reviewer", name: "Ola" }),
      send("POST", "/roles", { roleKey: "reviewer", name: "Olga" }),
    ]);

    expect(responses.map((response) => response.status).toSorted()).toEqual([201, 422]);
    expect(published).toHaveLength(1);
  });
});

describe("GET /api/roles", () => {
  it("lists the Roles in hiring order, each read on its own too", async () => {
    await hire("planner", "Jan");
    await hire("reviewer", "Ola");

    const listed = roleListSchema.parse(await get("/roles"));
    const reviewer = roleSchema.parse(await get("/roles/reviewer"));

    expect(listed.filter((role) => PRESET_KEYS.includes(role.key)).map((role) => role.key)).toEqual(
      ["planner", "reviewer"],
    );
    expect(reviewer).toEqual(listed.find((role) => role.key === "reviewer"));
  });

  it("answers 404 for a Role nobody fills", async () => {
    const response = await fetch(`${url}/api/roles/developer`);

    expect(response.status).toBe(404);
  });
});

describe("PUT /api/roles/:key/card", () => {
  it("saves the card as its next version, keeping the permission profile", async () => {
    const hired = await hire("developer", "Ada");
    const edit = {
      ...editOf(hired),
      taskLimit: 2,
      capabilities: { ...hired.card.capabilities, chat: true },
      permissionProfile: { edit: false, run: "read-only-git", web: false },
    };

    const response = await send("PUT", "/roles/developer/card", edit);

    expect(response.status).toBe(200);
    const role = roleSchema.parse(await response.json());
    expect(role.cardVersion).toBe(2);
    expect(role.card).toMatchObject({ taskLimit: 2, capabilities: { chat: true } });
    expect(role.card.permissionProfile).toEqual(hired.card.permissionProfile);
    expect(webEvents()).toEqual([
      { type: "role.hired", roleKey: "developer" },
      { type: "role.card-changed", roleKey: "developer" },
    ]);
  });

  it("refuses a card that breaks the rules, with every reason", async () => {
    const hired = await hire("developer", "Ada");

    const response = await send("PUT", "/roles/developer/card", {
      ...editOf(hired),
      taskLimit: 7,
      hardSwitches: { ...hired.card.hardSwitches, changeRoles: { kind: "ask-me" } },
    });

    expect(await reasonsOf(response)).toEqual([
      "A Task limit is 1 to 6 Tasks at once, or none.",
      "Change Roles stays Never until The Office can hold a call for it.",
    ]);
  });

  it("answers 400 for a body that isn't a card", async () => {
    await hire("developer", "Ada");

    const response = await send("PUT", "/roles/developer/card", { name: "Ada" });

    expect(response.status).toBe(400);
  });
});

describe("GET /api/roles/:key/card-versions", () => {
  it("lists the change history, newest first, with what changed and when", async () => {
    const hired = await hire("developer", "Ada");
    await send("PUT", "/roles/developer/card", { ...editOf(hired), effort: "max" });

    const versions = roleCardVersionListSchema.parse(await get("/roles/developer/card-versions"));

    expect(versions).toEqual([
      {
        version: 2,
        savedAt: expect.any(String),
        changes: [{ field: "effort", from: "high", to: "max" }],
      },
      { version: 1, savedAt: hired.hiredAt, changes: [] },
    ]);
  });
});
