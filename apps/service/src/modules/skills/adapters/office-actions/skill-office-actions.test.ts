import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  CHANGE_SKILL_EVERYONE_ACTION,
  CHANGE_SKILL_ROLES_ACTION,
  CHANGE_SKILL_STATE_ACTION,
  DELETE_SKILL_ACTION,
  EDIT_SKILL_ACTION,
  INSTALL_SKILL_ACTION,
  SKILLS_OFFICE_ACTIONS,
  UPDATE_SKILL_ACTION,
  WRITE_SKILL_ACTION,
  skillSchema,
  type Skill,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { OfficeIdentity } from "../../../../platform/git-identity/office-identity.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { RUN_EVERY_CALL, anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry, type OfficeToolUser } from "../../../engine/index.js";
import { RoleSkills } from "../../application/role-skills.js";
import { SessionPeople } from "../../application/session-people.js";
import { SkillLibrary } from "../../application/skill-library.js";
import type { PinnedVersion } from "../../domain/installed-source.js";
import { ANN_LEE, BEN_ITO } from "../../domain/user.fixtures.js";
import type { UserRef } from "../../domain/user.js";
import { SourceFetcher } from "../../ports/source-fetcher.js";
import { OwnSourcesFetcher } from "../git/git-source-fetcher.fixtures.js";
import {
  createSourceRepository,
  sourceSkillMd,
  type SourceRepository,
} from "../git/source-repository.fixtures.js";
import { aName, reasonsOf } from "../http/skills.controller.fixtures.js";
import { SkillsModule } from "../../skills.module.js";

/** git is slow while every test file runs at once. */
const GIT_TEST_TIMEOUT_MS = 30_000;

let officeData: string;
let app: INestApplication;
let url: string;
let source: SourceRepository;
let ownSourceUrls: string[];
/** The user behind the session's calls; none for a session nobody asked. */
let askedBy: UserRef | undefined;

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-skill-actions-"));
  ownSourceUrls = [];
  askedBy = ANN_LEE;
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      SkillsModule,
    ],
    overrides: [
      {
        provide: SourceFetcher,
        useFactory: (identity: OfficeIdentity) =>
          new OwnSourcesFetcher(identity, () => ownSourceUrls),
        inject: [OfficeIdentity],
      },
    ],
  }));
  app.get(SessionPeople).provide({ askedByInSession: () => Promise.resolve(askedBy) });
  source = await createSourceRepository();
  ownSourceUrls.push(source.url);
});

afterEach(async () => {
  await app.close();
  await source.remove();
  await rm(officeData, { recursive: true, force: true });
});

function send(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function skillOf(response: Response, status = 200): Promise<Skill> {
  expect(response.status).toBe(status);
  return skillSchema.parse(await response.json());
}

/** The Agent's call of the tool, from a session, optionally held and allowed by a user. */
function call(name: string, input: Record<string, unknown>, allowedBy?: OfficeToolUser) {
  const [tool] = app.get(OfficeToolRegistry).named([name], RUN_EVERY_CALL);
  if (!tool) throw new Error(`${name} isn't registered.`);
  return tool.run(input, { ...anOfficeToolCall("s-1"), ...(allowedBy && { allowedBy }) });
}

function registry(): OfficeToolRegistry {
  return app.get(OfficeToolRegistry);
}

async function written(name = aName()): Promise<string> {
  const skill = await app.get(SkillLibrary).write({
    name,
    description: "Writes release notes.",
    instructions: "Group them as Added, Changed and Fixed.",
  });
  return skill.name;
}

/** A skill of the Source, installed pinned at `tag`; returns its name and folder. */
async function installedFromSource(tag: string): Promise<string> {
  const name = `notes-${randomUUID().slice(0, 8)}`;
  await source.write(`${name}/SKILL.md`, sourceSkillMd("Notes.", name));
  const commit = source.commit();
  source.tag(tag);
  const pinnedVersion: PinnedVersion = { tag, commit };
  await app.get(SkillLibrary).install({ repository: source.url, folder: name, pinnedVersion });
  return name;
}

describe("the library's Office tools", () => {
  it("registers a tool for each declared action, under the group its Authority rules it by", () => {
    const names = SKILLS_OFFICE_ACTIONS.map(({ name }) => name);

    const tools = registry().named(names, RUN_EVERY_CALL);

    expect(tools.map(({ name }) => name)).toEqual(names);
    for (const tool of tools) {
      expect(tool.authority).toEqual(expect.objectContaining({ group: "skills" }));
    }
  });
});

describe("write_skill", () => {
  it("adds the skill through its route, waiting for review", async () => {
    const name = aName();

    const skill = await skillOf(
      await send("POST", "/skills", { name, description: "D.", instructions: "I." }),
      201,
    );

    expect(skill).toMatchObject({ name, source: "written", state: "waiting-for-review" });
  });

  it("refuses a taken name with its reasons through the route, and in words through the tool", async () => {
    const name = await written();
    const input = { name, description: "D.", instructions: "I." };

    expect(await reasonsOf(await send("POST", "/skills", input))).toEqual([
      `The library already has ${name}.`,
    ]);
    expect(await call(WRITE_SKILL_ACTION.name, input)).toEqual({
      isError: true,
      text: `The library already has ${name}.`,
    });
  });

  it("adds the skill for the Agent, and drafts it as a Proposal that a taken name changes", async () => {
    const name = aName();
    const input = { name, description: "D.", instructions: "I." };
    const drafted = await registry().draft(WRITE_SKILL_ACTION.name, input);

    expect(drafted).toMatchObject({
      subject: { kind: "skill", id: name, title: name },
      fields: [
        { label: "Description", after: "D." },
        { label: "Instructions", after: "I." },
      ],
    });
    const answer = await call(WRITE_SKILL_ACTION.name, input);
    expect(answer.isError).toBe(false);
    expect((await registry().draft(WRITE_SKILL_ACTION.name, input))?.fingerprint).not.toBe(
      drafted?.fingerprint,
    );
  });
});

describe("edit_skill", () => {
  it("saves the next version through its route", async () => {
    const name = await written();

    const skill = await skillOf(
      await send("PUT", `/skills/${name}`, { description: "New.", instructions: "New steps." }),
    );

    expect(skill).toMatchObject({ name, description: "New.", version: 2 });
  });

  it("saves it for the Agent, and a Proposal drafted before another edit is out of date", async () => {
    const name = await written();
    const input = { name, description: "New.", instructions: "New steps." };
    const drafted = await registry().draft(EDIT_SKILL_ACTION.name, input);
    expect(drafted?.fields).toEqual([
      expect.objectContaining({ label: "Description", before: "Writes release notes." }),
      expect.objectContaining({ label: "Instructions", before: expect.stringContaining("Group") }),
    ]);

    const applied = await registry().applyFor(EDIT_SKILL_ACTION.name, input, {
      user: ANN_LEE,
      proposedBy: "devops",
    });

    expect(applied.isError).toBe(false);
    expect((await app.get(SkillLibrary).read(name)).version).toBe(2);
    expect((await registry().draft(EDIT_SKILL_ACTION.name, input))?.fingerprint).not.toBe(
      drafted?.fingerprint,
    );
  });

  it("refuses an unknown skill with 404, and the Agent in words", async () => {
    const response = await send("PUT", `/skills/${aName()}`, {
      description: "D.",
      instructions: "I.",
    });

    expect(response.status).toBe(404);
    expect(
      (
        await call(EDIT_SKILL_ACTION.name, {
          name: "nothing",
          description: "D.",
          instructions: "I.",
        })
      ).isError,
    ).toBe(true);
  });
});

async function inSource(): Promise<string> {
  const name = `notes-${randomUUID().slice(0, 8)}`;
  await source.write(`${name}/SKILL.md`, sourceSkillMd("Notes.", name));
  source.commit();
  source.tag("v1.0");
  return name;
}

async function withNewerVersion(): Promise<string> {
  const name = await installedFromSource("v1.0");
  await source.write(`${name}/NOTES.md`, "More.\n");
  source.commit();
  source.tag("v1.1");
  return name;
}

describe("install_skill", () => {
  it(
    "installs the skill at the Source's pinned version through its route",
    { timeout: GIT_TEST_TIMEOUT_MS },
    async () => {
      const folder = await inSource();

      const skill = await skillOf(
        await send("POST", "/skills/installs", { source: source.url, folder }),
        201,
      );

      expect(skill).toMatchObject({
        name: folder,
        source: "installed",
        state: "waiting-for-review",
        installedFrom: { repository: source.url, folder, pinnedVersion: { tag: "v1.0" } },
      });
    },
  );

  it(
    "installs it for the Agent, and refuses a folder that holds no skill",
    { timeout: GIT_TEST_TIMEOUT_MS },
    async () => {
      const folder = await inSource();

      expect((await call(INSTALL_SKILL_ACTION.name, { source: source.url, folder })).isError).toBe(
        false,
      );
      expect(
        await reasonsOf(
          await send("POST", "/skills/installs", { source: source.url, folder: "nothing" }),
        ),
      ).toEqual([`${source.url} has no skill in "nothing"; list_source_skills shows its folders.`]);
    },
  );

  it(
    "drafts what it writes, and a Source that moved on since is a changed subject",
    { timeout: GIT_TEST_TIMEOUT_MS },
    async () => {
      const folder = await inSource();
      const input = { source: source.url, folder };

      const drafted = await registry().draft(INSTALL_SKILL_ACTION.name, input);

      expect(drafted?.subject).toMatchObject({ title: folder });
      expect(drafted?.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "Pinned version", after: "v1.0" }),
          expect.objectContaining({ label: "Files", after: "SKILL.md" }),
        ]),
      );
      await source.write(`${folder}/SKILL.md`, sourceSkillMd("Changed notes.", folder));
      source.commit();
      source.tag("v1.1");
      expect((await registry().draft(INSTALL_SKILL_ACTION.name, input))?.fingerprint).not.toBe(
        drafted?.fingerprint,
      );
    },
  );
});

describe("update_skill", () => {
  it(
    "updates the skill to its Source's newest version through its route",
    { timeout: GIT_TEST_TIMEOUT_MS },
    async () => {
      const name = await withNewerVersion();

      const skill = await skillOf(await send("POST", `/skills/${name}/update`, {}));

      expect(skill.installedFrom?.pinnedVersion.tag).toBe("v1.1");
    },
  );

  it(
    "updates it for the Agent, showing the versions and the diff in its draft",
    { timeout: GIT_TEST_TIMEOUT_MS },
    async () => {
      const name = await withNewerVersion();
      const input = { name, notes: "Adds notes." };

      const drafted = await registry().draft(UPDATE_SKILL_ACTION.name, input);

      expect(drafted?.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "Notes", after: "Adds notes." }),
          expect.objectContaining({ label: "Version", before: "v1.0", after: "v1.1" }),
          expect.objectContaining({ label: "Changes", after: expect.stringContaining("NOTES.md") }),
        ]),
      );
      expect((await call(UPDATE_SKILL_ACTION.name, input)).isError).toBe(false);
      expect((await app.get(SkillLibrary).read(name)).installedFrom?.pinnedVersion.tag).toBe(
        "v1.1",
      );
    },
  );

  it(
    "refuses when the Source has nothing newer, and for a skill that wasn't installed",
    { timeout: GIT_TEST_TIMEOUT_MS },
    async () => {
      const name = await installedFromSource("v1.0");

      expect(await reasonsOf(await send("POST", `/skills/${name}/update`, {}))).toEqual([
        `${name} is pinned at v1.0, the newest version of ${source.url}.`,
      ]);
      const own = await written();
      expect((await call(UPDATE_SKILL_ACTION.name, { name: own })).isError).toBe(true);
    },
  );
});

describe("change_skill_state", () => {
  it("turns the skill on and off through its route and for the Agent", async () => {
    const name = await written();

    expect((await skillOf(await send("PUT", `/skills/${name}/state`, { state: "on" }))).state).toBe(
      "on",
    );
    expect(await call(CHANGE_SKILL_STATE_ACTION.name, { name, state: "off" })).toEqual({
      isError: false,
      text: `The skill ${name} is off now.`,
    });
    expect((await app.get(SkillLibrary).read(name)).state).toBe("off");
  });

  it("drafts the state as it is, and a new version since is a changed subject", async () => {
    const name = await written();
    const input = { name, state: "on" };
    const drafted = await registry().draft(CHANGE_SKILL_STATE_ACTION.name, input);
    expect(drafted?.fields).toEqual([
      expect.objectContaining({ label: "State", before: "waiting-for-review", after: "on" }),
    ]);

    await app.get(SkillLibrary).edit(name, { description: "New.", instructions: "New." });

    expect((await registry().draft(CHANGE_SKILL_STATE_ACTION.name, input))?.fingerprint).not.toBe(
      drafted?.fingerprint,
    );
  });
});

describe("change_skill_everyone", () => {
  // Marked for everyone while waiting for review: a skill on and for everyone would reach the
  // sessions other test files prepare on the shared database.
  it("marks the skill for everyone and back, through its route and for the Agent", async () => {
    const name = await written();

    expect(
      (await skillOf(await send("PUT", `/skills/${name}/everyone`, { everyone: true }))).everyone,
    ).toBe(true);
    const answer = await call(CHANGE_SKILL_EVERYONE_ACTION.name, { name, everyone: false });

    expect(answer).toEqual({
      isError: false,
      text: `The skill ${name} no longer comes with every Role now.`,
    });
    expect((await app.get(SkillLibrary).read(name)).everyone).toBe(false);
  });
});

describe("change_skill_roles", () => {
  it("assigns the Roles through its route, recording the signed-in user", async () => {
    const name = await written();
    const roleKey = `role-${randomUUID()}`;

    const skill = await skillOf(await send("PUT", `/skills/${name}/roles`, { roles: [roleKey] }));

    expect(skill.roles).toEqual([roleKey]);
    const [change] = await app.get(RoleSkills).changes(roleKey);
    expect(change?.changedBy).toEqual(ANN_LEE);
  });

  it("assigns them for the Agent as the user who asked it", async () => {
    const name = await written();
    const roleKey = `role-${randomUUID()}`;
    askedBy = BEN_ITO;

    const answer = await call(CHANGE_SKILL_ROLES_ACTION.name, { name, roles: [roleKey] });

    expect(answer).toEqual({
      isError: false,
      text: `The skill ${name} is assigned to ${roleKey} now.`,
    });
    const [change] = await app.get(RoleSkills).changes(roleKey);
    expect(change?.changedBy).toEqual(BEN_ITO);
  });

  it("records the user who allowed the call when nobody asked, and refuses when nobody is behind it", async () => {
    const name = await written();
    const roleKey = `role-${randomUUID()}`;
    askedBy = undefined;

    const refused = await call(CHANGE_SKILL_ROLES_ACTION.name, { name, roles: [roleKey] });
    const allowed = await call(
      CHANGE_SKILL_ROLES_ACTION.name,
      { name, roles: [roleKey] },
      { userId: BEN_ITO.userId, name: BEN_ITO.name },
    );

    expect(refused.isError).toBe(true);
    expect(allowed.isError).toBe(false);
    expect((await app.get(RoleSkills).changes(roleKey))[0]?.changedBy).toEqual(BEN_ITO);
  });

  it("applies a Proposal as the user who applies it", async () => {
    const name = await written();
    const roleKey = `role-${randomUUID()}`;
    const input = { name, roles: [roleKey] };
    const drafted = await registry().draft(CHANGE_SKILL_ROLES_ACTION.name, input);
    expect(drafted?.fields).toEqual([
      expect.objectContaining({ label: "Roles", before: "", after: roleKey }),
    ]);

    const applied = await registry().applyFor(CHANGE_SKILL_ROLES_ACTION.name, input, {
      user: BEN_ITO,
      proposedBy: "devops",
    });

    expect(applied.isError).toBe(false);
    expect((await app.get(RoleSkills).changes(roleKey))[0]?.changedBy).toEqual(BEN_ITO);
  });

  it("answers 404 for a skill the library doesn't have", async () => {
    expect((await send("PUT", `/skills/${aName()}/roles`, { roles: [] })).status).toBe(404);
  });
});

describe("delete_skill", () => {
  it("removes the skill through its route with 204", async () => {
    const name = await written();

    const response = await send("DELETE", `/skills/${name}`);

    expect(response.status).toBe(204);
    expect((await fetch(`${url}/api/skills/${name}`)).status).toBe(404);
  });

  it("removes it for the Agent, who then finds it gone", async () => {
    const name = await written();

    expect(await call(DELETE_SKILL_ACTION.name, { name })).toEqual({
      isError: false,
      text: `The skill ${name} is removed from the library.`,
    });
    expect((await call(DELETE_SKILL_ACTION.name, { name })).isError).toBe(true);
  });
});
