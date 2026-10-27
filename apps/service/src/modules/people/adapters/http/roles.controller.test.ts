import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  presetListSchema,
  roleCardOptionsSchema,
  roleChangeListSchema,
  roleListSchema,
  roleRefusalSchema,
  roleSchema,
  roleWebEventSchema,
  skillWebEventSchema,
  type Role,
  type RoleCard,
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
import { RoleSkills, SkillLibrary } from "../../../skills/index.js";
import { PRESETS } from "../../domain/presets.js";
import { PeopleModule } from "../../people.module.js";
import { roles } from "../postgres/roles.schema.js";

// The only test file that hires from the presets: their Roles' keys are fixed, and every test
// file shares the database, so it removes them, and takes their skills away, before each test
// (apps/service/docs/testing.md). A person's history starts at the hire, so that change isn't in it.
const PRESET_KEYS = PRESETS.map((preset) => preset.roleKey);

let officeData: string;
let app: INestApplication;
let url: string;
let published: DomainEvent[];

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-roles-"));
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      PeopleModule,
    ],
  }));
  await app.get<Database>(DATABASE).delete(roles).where(inArray(roles.key, PRESET_KEYS));
  for (const roleKey of PRESET_KEYS) await app.get(RoleSkills).assignToRole(roleKey, []);
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
    const { occurredAt: _occurredAt, ...webEvent } = roleWebEventSchema
      .or(skillWebEventSchema)
      .parse(forwarding.toWebEvent(event));
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

/** A skill of the test's own in the library, on. */
async function anOnSkill(): Promise<string> {
  const name = `tdd-${randomUUID().slice(0, 8)}`;
  const library = app.get(SkillLibrary);
  await library.write({ name, description: "Test first.", instructions: "Red, green, refactor." });
  await library.turnOn(name);
  return name;
}

function editOf({ card }: Role): RoleCard {
  return card;
}

describe("GET /api/presets", () => {
  it("lists the Planner, the Developer, the Reviewer, the CTO and the Office Manager with their cards", async () => {
    const presets = presetListSchema.parse(await get("/presets"));

    expect(presets.map(({ roleKey, suggestedName }) => ({ roleKey, suggestedName }))).toEqual([
      { roleKey: "planner", suggestedName: "Jan" },
      { roleKey: "developer", suggestedName: "Ada" },
      { roleKey: "reviewer", suggestedName: "Ola" },
      { roleKey: "cto", suggestedName: "Bob" },
      { roleKey: "office-manager", suggestedName: "Marta" },
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

  it("hires the Office Manager, who only talks and changes Roles by asking the user", async () => {
    const role = await hire("office-manager", "Marta");

    expect(role).toMatchObject({
      key: "office-manager",
      card: {
        name: "Marta",
        title: "Office Manager",
        capabilities: { sharedMemory: true, chat: true, consultant: false },
        taskLimit: "none",
        hardSwitches: { changeRoles: { kind: "ask-me" } },
      },
      askingYouUntilHired: [],
    });
  });

  it("hires the CTO, a Consultant who publishes outside the Pipeline only by asking the user", async () => {
    const role = await hire("cto", "Bob");

    expect(role).toMatchObject({
      key: "cto",
      card: {
        name: "Bob",
        title: "CTO",
        capabilities: { sharedMemory: true, chat: true, consultant: true },
        taskLimit: 2,
        hardSwitches: {
          runInstalls: { kind: "consult", role: "devops" },
          publishOutsideThePipeline: { kind: "ask-me" },
          changeRoles: { kind: "never" },
        },
      },
      askingYouUntilHired: ["runInstalls"],
    });
  });

  it("refuses a Role someone already fills, with every reason", async () => {
    await hire("planner", "Jan");

    const response = await send("POST", "/roles", { roleKey: "planner", name: " " });

    expect(await reasonsOf(response)).toEqual([
      "Give the person a name.",
      "Jan already fills the Planner Role.",
    ]);
  });

  it("hires a person from scratch into a new Role keyed from its title, with its skills", async () => {
    const title = `Analyst ${randomUUID().slice(0, 8)}`;
    const roleKey = title.toLowerCase().replace(" ", "-");
    const skill = await anOnSkill();
    const { card: presetCard } = roleSchema.parse(await hire("developer", "Ada"));
    const card = { ...presetCard, name: "Mia", title, skills: [skill] };

    try {
      const response = await send("POST", "/roles", { card });

      expect(response.status).toBe(201);
      const role = roleSchema.parse(await response.json());
      expect(role).toMatchObject({ key: roleKey, cardVersion: 1, card });
      expect(roleSchema.parse(await get(`/roles/${roleKey}`)).card.skills).toEqual([skill]);
      expect(webEvents()).toContainEqual({ type: "role.hired", roleKey });
    } finally {
      await app
        .get<Database>(DATABASE)
        .delete(roles)
        .where(inArray(roles.key, [roleKey]));
      await app.get(RoleSkills).assignToRole(roleKey, []);
    }
  });

  it("refuses to hire from scratch into a Role the presets keep, or with a skill the library lacks", async () => {
    const { card } = roleSchema.parse(await hire("developer", "Ada"));

    const response = await send("POST", "/roles", {
      card: { ...card, title: "Office Manager", skills: ["no-such-skill"] },
    });

    expect(await reasonsOf(response)).toEqual([
      "Hire the Office Manager Role from its preset.",
      "The library has no skill no-such-skill.",
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

describe("POST /api/roles/:key/let-go and /hire-back", () => {
  it("lets the person go, keeping their card, and hires them back as they were", async () => {
    const hired = await hire("developer", "Ada");
    published = [];

    const letGo = roleSchema.parse(
      await (await send("POST", "/roles/developer/let-go", {})).json(),
    );

    expect(letGo).toMatchObject({ key: "developer", card: hired.card });
    expect(letGo.letGoAt).not.toBeNull();
    expect(roleSchema.parse(await get("/roles/developer")).letGoAt).toBe(letGo.letGoAt);

    const back = roleSchema.parse(
      await (await send("POST", "/roles/developer/hire-back", {})).json(),
    );

    expect(back).toMatchObject({ key: "developer", card: hired.card, letGoAt: null });
    expect(webEvents()).toEqual([
      { type: "role.let-go", roleKey: "developer" },
      { type: "role.hired-back", roleKey: "developer" },
    ]);
  });

  it("refuses to let go twice, to hire back a person who fills the Role, and to hire another in", async () => {
    await hire("developer", "Ada");
    expect(await reasonsOf(await send("POST", "/roles/developer/hire-back", {}))).toEqual([
      "Ada fills the Developer Role; nobody was let go.",
    ]);
    await send("POST", "/roles/developer/let-go", {});

    expect(await reasonsOf(await send("POST", "/roles/developer/let-go", {}))).toEqual([
      "Ada was let go from the Developer Role already.",
    ]);
    expect(
      await reasonsOf(await send("POST", "/roles", { roleKey: "developer", name: "Bob" })),
    ).toEqual(["Ada was let go from the Developer Role; hire Ada back."]);
  });

  it("answers 404 for a Role nobody was hired into", async () => {
    expect((await send("POST", "/roles/developer/let-go", {})).status).toBe(404);
  });
});

describe("PUT /api/roles/:key/card", () => {
  it("saves the card as its next version, with its permission profile", async () => {
    const hired = await hire("developer", "Ada");
    const permissionProfile = { edit: false, run: "read-only-git", web: true };
    const edit = {
      ...editOf(hired),
      taskLimit: 2,
      capabilities: { ...hired.card.capabilities, chat: true },
      permissionProfile,
    };

    const response = await send("PUT", "/roles/developer/card", edit);

    expect(response.status).toBe(200);
    const role = roleSchema.parse(await response.json());
    expect(role.cardVersion).toBe(2);
    expect(role.card).toMatchObject({
      taskLimit: 2,
      capabilities: { chat: true },
      permissionProfile,
    });
    expect(roleSchema.parse(await get("/roles/developer")).card.permissionProfile).toEqual(
      permissionProfile,
    );
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
      hardSwitches: {
        ...hired.card.hardSwitches,
        changeRoles: { kind: "consult", role: "janitor" },
      },
    });

    expect(await reasonsOf(response)).toEqual([
      "A Task limit is 1 to 6 Tasks at once, or none.",
      "Change Roles consults a Role The Office doesn't know.",
    ]);
  });

  it("gives the Role exactly the skills the card names, for its next sessions", async () => {
    const hired = await hire("planner", "Jan");
    const [grilling, tdd] = [await anOnSkill(), await anOnSkill()];
    await send("PUT", "/roles/planner/card", { ...editOf(hired), skills: [grilling, tdd] });
    published = [];

    const response = await send("PUT", "/roles/planner/card", {
      ...editOf(hired),
      skills: [tdd],
    });

    expect(response.status).toBe(200);
    expect(roleSchema.parse(await response.json()).card.skills).toEqual([tdd]);
    expect(roleSchema.parse(await get("/roles/planner")).card.skills).toEqual([tdd]);
    expect(webEvents()).toEqual([{ type: "skill.role-skills-changed", roleKey: "planner" }]);
  });

  it("refuses a skill the library lacks together with the card's own reasons, saving neither", async () => {
    const hired = await hire("developer", "Ada");

    const response = await send("PUT", "/roles/developer/card", {
      ...editOf(hired),
      title: "",
      skills: ["no-such-skill"],
    });

    expect(await reasonsOf(response)).toEqual([
      "Give the Role a title.",
      "The library has no skill no-such-skill.",
    ]);
    expect(roleSchema.parse(await get("/roles/developer")).cardVersion).toBe(1);
  });

  it("answers 400 for a body that isn't a card", async () => {
    await hire("developer", "Ada");

    const response = await send("PUT", "/roles/developer/card", { name: "Ada" });

    expect(response.status).toBe(400);
  });
});

describe("GET /api/roles/:key/changes", () => {
  it("lists the change history, newest first, down to the hire", async () => {
    const hired = await hire("developer", "Ada");
    const tdd = await anOnSkill();
    await send("PUT", "/roles/developer/card", { ...editOf(hired), effort: "max", skills: [tdd] });

    const changes = roleChangeListSchema.parse(await get("/roles/developer/changes"));

    expect(changes).toEqual([
      { kind: "skills-changed", at: expect.any(String), added: [tdd], removed: [] },
      {
        kind: "card-changed",
        at: expect.any(String),
        cardVersion: 2,
        changes: [{ field: "effort", from: "high", to: "max" }],
        proposedBy: null,
      },
      { kind: "hired", at: hired.hiredAt, proposedBy: null },
    ]);
  });
});
