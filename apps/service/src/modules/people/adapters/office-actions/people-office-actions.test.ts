import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  CHANGE_ROLE_CARD_ACTION,
  DELETE_MEMORY_NOTE_ACTION,
  HIRE_BACK_ROLE_ACTION,
  HIRE_ROLE_ACTION,
  LET_GO_ROLE_ACTION,
  memorySchema,
  PEOPLE_OFFICE_ACTIONS,
  REMOVE_AVATAR_ACTION,
  roleChangeListSchema,
  roleRefusalSchema,
  roleSchema,
  SET_AVATAR_FROM_ATTACHMENT_ACTION,
  type Role,
  type RoleCard,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { anOfficeToolCall, RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry, type OfficeTool } from "../../../engine/index.js";
import { AvatarSources } from "../../application/avatar-sources.js";
import { SessionPeople } from "../../application/session-people.js";
import { RoleRefused } from "../../domain/role-refused.js";
import { aCardToSend } from "../../domain/role.fixtures.js";
import { ANN_LEE } from "../../domain/user.fixtures.js";
import { PeopleModule } from "../../people.module.js";
import { PNG } from "../http/avatars.controller.fixtures.js";

let officeData: string;
let app: INestApplication;
let url: string;
/** The Role each session's person fills, as Conversations gives them. */
let sessions: Map<string, string>;
/** The Attachments' bytes, by id, as Work gives them. */
let attachments: Map<string, Uint8Array>;

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-people-actions-"));
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
  sessions = new Map();
  attachments = new Map();
  app.get(SessionPeople).provide({ personInSession: (id) => Promise.resolve(sessions.get(id)) });
  app.get(AvatarSources).provide({
    contentOf: (id) => {
      const content = attachments.get(id);
      return content
        ? Promise.resolve(content)
        : Promise.reject(new RoleRefused([`The Office has no Attachment ${id}.`]));
    },
  });
});

afterEach(async () => {
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

function toolOf(name: string): OfficeTool {
  const [tool] = app.get(OfficeToolRegistry).named([name], RUN_EVERY_CALL);
  if (!tool) throw new Error(`${name} is not registered.`);
  return tool;
}

/** The tool `name` called from the session `sessionId`, whose person fills the Role `roleKey`. */
function call(name: string, input: unknown, roleKey: string, sessionId = `s-${roleKey}`) {
  sessions.set(sessionId, roleKey);
  const tool = toolOf(name);
  return tool.run(tool.input.parse(input), anOfficeToolCall(sessionId));
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

function aCard(title: string, fields: Partial<RoleCard> = {}): RoleCard {
  return {
    ...aCardToSend({
      name: "Ada",
      title,
      capabilities: { sharedMemory: true, chat: true, consultant: false, runEnvironment: false },
      ...fields,
    }),
    skills: [],
  };
}

function aTitle(): string {
  return `Painter ${randomUUID().slice(0, 8)}`;
}

function keyOf(title: string): string {
  return title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
}

/** Someone in a Role of their own, hired through the route. */
async function hired(fields: Partial<RoleCard> = {}): Promise<Role> {
  const response = await send("POST", "/roles", { card: aCard(aTitle(), fields) });
  expect(response.status).toBe(201);
  return roleSchema.parse(await response.json());
}

async function history(key: string) {
  return roleChangeListSchema.parse(await (await send("GET", `/roles/${key}/changes`)).json());
}

describe("People's Office actions", () => {
  it("are all registered as tools, in the area and group of their declaration", () => {
    for (const { name, group } of PEOPLE_OFFICE_ACTIONS) {
      expect(toolOf(name).authority?.group).toBe(group);
    }
  });
});

describe("hire_role", () => {
  it("hires from scratch through its tool as the person's own call, recording who proposed it", async () => {
    const title = aTitle();

    const result = await call(HIRE_ROLE_ACTION.name, { card: aCard(title) }, "office-manager");

    expect(result).toEqual({ text: `Ada is hired into the Role ${keyOf(title)}.`, isError: false });
    expect(await history(keyOf(title))).toEqual([
      expect.objectContaining({ kind: "hired", proposedBy: "office-manager", savedBy: null }),
    ]);
  });

  it("hires from scratch through its route", async () => {
    const title = aTitle();

    const response = await send(HIRE_ROLE_ACTION.route.method, HIRE_ROLE_ACTION.route.path, {
      card: aCard(title),
    });

    expect(response.status).toBe(201);
    expect(roleSchema.parse(await response.json()).key).toBe(keyOf(title));
  });

  it("is drafted and applied for the user who applies it, with who proposed it", async () => {
    const tool = toolOf(HIRE_ROLE_ACTION.name);
    const title = aTitle();
    const input = tool.input.parse({ card: aCard(title) });

    const draft = await tool.draft?.(input);
    const applied = await tool.applyFor?.(input, { user: ANN_LEE, proposedBy: "office-manager" });

    expect(draft?.subject).toEqual({ kind: "role", id: keyOf(title), title: "Ada" });
    expect(applied?.isError).toBe(false);
    expect(await history(keyOf(title))).toEqual([
      expect.objectContaining({
        kind: "hired",
        proposedBy: "office-manager",
        savedBy: { userId: ANN_LEE.userId, name: ANN_LEE.name },
      }),
    ]);
  });

  it("asks for a preset with its name, or a card, not both nor neither", () => {
    expect(HIRE_ROLE_ACTION.input.safeParse({}).success).toBe(false);
    expect(HIRE_ROLE_ACTION.input.safeParse({ roleKey: "developer" }).success).toBe(false);
    expect(
      HIRE_ROLE_ACTION.input.safeParse({
        roleKey: "developer",
        name: "Ada",
        card: aCard("Painter"),
      }).success,
    ).toBe(false);
    expect(HIRE_ROLE_ACTION.input.safeParse({ roleKey: "developer", name: "Ada" }).success).toBe(
      true,
    );
  });
});

describe("change_role_card", () => {
  it("saves the card through its route, as the signed-in user", async () => {
    const role = await hired();
    const { skills: _skills, ...card } = aCard(role.card.title, { responsibilities: "Paints." });

    const response = await send("PUT", `/roles/${role.key}/card`, { ...card, skills: [] });

    expect(response.status).toBe(200);
    expect(roleSchema.parse(await response.json()).card.responsibilities).toBe("Paints.");
  });

  it("saves the card through its tool, recording the person and no user", async () => {
    const role = await hired();

    const result = await call(
      CHANGE_ROLE_CARD_ACTION.name,
      { key: role.key, ...aCard(role.card.title, { responsibilities: "Paints walls." }) },
      "office-manager",
    );

    expect(result.isError).toBe(false);
    expect((await history(role.key))[0]).toMatchObject({
      kind: "card-changed",
      proposedBy: "office-manager",
      savedBy: null,
    });
  });

  it("lists in its draft only the fields that differ, with what the card has now", async () => {
    const role = await hired();
    const tool = toolOf(CHANGE_ROLE_CARD_ACTION.name);
    const input = tool.input.parse({
      key: role.key,
      ...aCard(role.card.title, { responsibilities: "Paints walls." }),
    });

    const draft = await tool.draft?.(input);

    expect(draft?.fields).toEqual([
      expect.objectContaining({
        label: "Responsibilities",
        before: role.card.responsibilities,
        after: "Paints walls.",
      }),
    ]);
  });

  it("is held to the trust anchor's cap: Allowed on Change Roles is refused, on a route and a tool", async () => {
    const role = await hired();
    const allowed = aCard(role.card.title, {
      authority: { ...role.card.authority, changeRoles: { kind: "allowed" } },
    });

    const refused = await send("PUT", `/roles/${role.key}/card`, allowed);
    const result = await call(
      CHANGE_ROLE_CARD_ACTION.name,
      { key: role.key, ...allowed },
      "office-manager",
    );

    expect(refused.status).toBe(422);
    expect(roleRefusalSchema.parse(await refused.json()).reasons.join(" ")).toContain(
      "Change Roles",
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Change Roles");
  });
});

describe("let_go_role and hire_back_role", () => {
  it("let a person go and hire them back, through their routes and their tools", async () => {
    const role = await hired();

    const letGo = await send("POST", `/roles/${role.key}/let-go`);
    expect(roleSchema.parse(await letGo.json()).letGoAt).not.toBeNull();
    const back = await call(HIRE_BACK_ROLE_ACTION.name, { key: role.key }, "office-manager");
    expect(back).toEqual({
      text: `Ada is hired back into the Role ${role.key}.`,
      isError: false,
    });
    const gone = await call(LET_GO_ROLE_ACTION.name, { key: role.key }, "office-manager");
    expect(gone).toEqual({
      text: `Ada is let go: nobody fills the Role ${role.key} from now on.`,
      isError: false,
    });
    const again = await call(LET_GO_ROLE_ACTION.name, { key: role.key }, "office-manager");
    expect(again.isError).toBe(true);
  });
});

async function aNote(role: Role): Promise<string> {
  const response = await send("POST", `/roles/${role.key}/memory`, { text: "Likes blue." });
  expect(response.status).toBe(201);
  const memory = memorySchema.parse(await (await send("GET", `/roles/${role.key}/memory`)).json());
  return memory.notes[0]?.id ?? "";
}

describe("delete_memory_note", () => {
  it("lets a person delete a note of their own Memory", async () => {
    const role = await hired();
    const noteId = await aNote(role);

    const result = await call(DELETE_MEMORY_NOTE_ACTION.name, { key: role.key, noteId }, role.key);

    expect(result).toEqual({ text: "The Memory note is deleted.", isError: false });
    const memory = memorySchema.parse(
      await (await send("GET", `/roles/${role.key}/memory`)).json(),
    );
    expect(memory.notes).toEqual([]);
  });

  it("refuses a person another's note, keeping it", async () => {
    const [mine, theirs] = [await hired(), await hired()];
    const noteId = await aNote(theirs);

    const result = await call(
      DELETE_MEMORY_NOTE_ACTION.name,
      { key: theirs.key, noteId },
      mine.key,
    );

    expect(result.isError).toBe(true);
    expect(result.text).toContain("their own Memory and Avatar only");
    const memory = memorySchema.parse(
      await (await send("GET", `/roles/${theirs.key}/memory`)).json(),
    );
    expect(memory.notes).toHaveLength(1);
  });

  it("is checked up front, so a refused call is neither held nor drafted", async () => {
    const [mine, theirs] = [await hired(), await hired()];
    sessions.set("s-mine", mine.key);

    const refusal = await toolOf(DELETE_MEMORY_NOTE_ACTION.name).authority?.check?.(
      { key: theirs.key, noteId: "x" },
      anOfficeToolCall("s-mine"),
    );

    expect(refusal).toContain("own Memory and Avatar only");
  });

  it("lets the user delete any person's note through the route", async () => {
    const role = await hired();
    const noteId = await aNote(role);

    const response = await send("DELETE", `/roles/${role.key}/memory/${noteId}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ key: role.key, noteId });
  });
});

describe("set_avatar_from_attachment and remove_avatar", () => {
  const ATTACHMENT = randomUUID();

  it("makes an image Attachment the person's own Avatar, and removes it", async () => {
    const role = await hired();
    attachments.set(ATTACHMENT, PNG);

    const set = await call(
      SET_AVATAR_FROM_ATTACHMENT_ACTION.name,
      { key: role.key, attachmentId: ATTACHMENT },
      role.key,
    );
    const after = roleSchema.parse(await (await send("GET", `/roles/${role.key}`)).json());
    const removed = await call(REMOVE_AVATAR_ACTION.name, { key: role.key }, role.key);

    expect(set.isError).toBe(false);
    expect(after.avatar?.mediaType).toBe("image/png");
    expect(removed.isError).toBe(false);
    expect(
      roleSchema.parse(await (await send("GET", `/roles/${role.key}`)).json()).avatar,
    ).toBeNull();
  });

  it("refuses an Attachment that is no image, keeping the Avatar", async () => {
    const role = await hired();
    attachments.set(ATTACHMENT, new TextEncoder().encode("<html>a page</html>"));

    const result = await call(
      SET_AVATAR_FROM_ATTACHMENT_ACTION.name,
      { key: role.key, attachmentId: ATTACHMENT },
      role.key,
    );

    expect(result).toEqual({
      text: "The file isn't a PNG, JPEG, WebP or SVG image.",
      isError: true,
    });
  });

  it("refuses a person another's Avatar, set or removed", async () => {
    const [mine, theirs] = [await hired(), await hired()];
    attachments.set(ATTACHMENT, PNG);

    const set = await call(
      SET_AVATAR_FROM_ATTACHMENT_ACTION.name,
      { key: theirs.key, attachmentId: ATTACHMENT },
      mine.key,
    );
    const removed = await call(REMOVE_AVATAR_ACTION.name, { key: theirs.key }, mine.key);

    expect(set.isError).toBe(true);
    expect(removed.isError).toBe(true);
    expect(
      roleSchema.parse(await (await send("GET", `/roles/${theirs.key}`)).json()).avatar,
    ).toBeNull();
  });

  it("lets the user set and remove anyone's Avatar through the routes", async () => {
    const role = await hired();
    attachments.set(ATTACHMENT, PNG);

    const set = await send("POST", `/roles/${role.key}/avatar/from-attachment`, {
      attachmentId: ATTACHMENT,
    });
    const removed = await send("DELETE", `/roles/${role.key}/avatar`);

    expect(set.status).toBe(201);
    expect(roleSchema.parse(await set.json()).avatar?.mediaType).toBe("image/png");
    expect(removed.status).toBe(200);
    expect(roleSchema.parse(await removed.json()).avatar).toBeNull();
  });
});

describe("a call from a session nobody keeps", () => {
  it("is refused in words", async () => {
    const role = await hired();
    const tool = toolOf(LET_GO_ROLE_ACTION.name);

    const result = await tool.run({ key: role.key }, anOfficeToolCall("nobody"));

    expect(result).toEqual({
      text: "The Office doesn't know whose session this is.",
      isError: true,
    });
  });
});
