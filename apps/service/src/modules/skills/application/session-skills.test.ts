import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import {
  createProjectCheckout,
  projectSkillMd,
  type ProjectCheckout,
} from "../adapters/git/project-checkout.fixtures.js";
import { SessionSkillsNotFound } from "../domain/session-skills-not-found.js";
import { SkillVersionMissing } from "../domain/skill-version-missing.js";
import { SkillsModule } from "../skills.module.js";
import { SessionSkills } from "./session-skills.js";
import { SkillLibrary } from "./skill-library.js";

let officeData: string;
let checkout: ProjectCheckout;
let app: INestApplication;
let library: SkillLibrary;
let sessionSkills: SessionSkills;

async function start(): Promise<void> {
  ({ app } = await startTestApplication({
    database: true,
    imports: [EventsModule, EventStreamModule, OfficeDataModule.forRoot(officeData), SkillsModule],
  }));
  library = app.get(SkillLibrary);
  sessionSkills = app.get(SessionSkills);
}

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-session-skills-"));
  checkout = await createProjectCheckout();
  await checkout.write(".claude/skills/deploy/SKILL.md", projectSkillMd("deploy", "Deploys."));
  await checkout.write(".claude/commands/ship.md", "Ship it.");
  checkout.commit();
  await start();
});

afterEach(async () => {
  await app.close();
  await rm(officeData, { recursive: true, force: true });
  await checkout.remove();
});

/** A name of the test's own, since every test file shares the database. */
function aName(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

async function anOnSkill(name: string, instructions = "Do it."): Promise<void> {
  await library.write({ name, description: `Uses ${name}.`, instructions });
  await library.turnOn(name);
}

function sessionFolder(sessionId: string): string {
  return join(officeData, "sessions", sessionId, "skills");
}

describe("SessionSkills", () => {
  it("gives a session its Role's skills and the skills for everyone, and the Project's", async () => {
    const tdd = aName("tdd");
    const style = aName("house-style");
    const unused = aName("unused");
    await anOnSkill(tdd);
    await anOnSkill(style);
    await anOnSkill(unused);
    const sessionId = randomUUID();

    // A skill for everyone reaches every session prepared on the shared database, so it is
    // for everyone only as long as this session takes to prepare.
    await library.changeEveryone(style, true);
    const prepared = await sessionSkills
      .prepare({
        sessionId,
        roleSkills: [tdd],
        project: { folder: checkout.path, useProjectSkills: true },
      })
      .finally(() => library.remove(style));

    expect(prepared.folder).toBe(sessionFolder(sessionId));
    const officeNames = [`office:${style}`, `office:${tdd}`].toSorted();
    expect(prepared.names).toEqual([...officeNames, "deploy", "ship"]);
    expect(prepared.expected).toEqual([...officeNames, "deploy", "ship"].toSorted());
    expect(prepared.overrides).toEqual({});
    expect((await readdir(join(prepared.folder, "skills"))).toSorted()).toEqual(
      [style, tdd].toSorted(),
    );
  });

  it("turns the Project's skills off, by bare name, when the Project doesn't use them", async () => {
    const prepared = await sessionSkills.prepare({
      sessionId: randomUUID(),
      roleSkills: [],
      project: { folder: checkout.path, useProjectSkills: false },
    });

    expect(prepared.names).toEqual([]);
    expect(prepared.expected).toEqual([]);
    expect(prepared.overrides).toEqual({ deploy: "off", ship: "off" });
  });

  it("reports an allowed Project skill that also allows a library skill by its suffix", async () => {
    const name = aName("deploy");
    await checkout.write(`.claude/skills/${name}/SKILL.md`, projectSkillMd(name, "Theirs."));
    await anOnSkill(name);

    const prepared = await sessionSkills.prepare({
      sessionId: randomUUID(),
      roleSkills: [name],
      project: { folder: checkout.path, useProjectSkills: true },
    });

    expect(prepared.suffixMatches).toEqual([
      `The Project's skill ${name} also allows the library's office:${name}, which this session has too.`,
    ]);
  });

  it("keeps the version a session got, and rebuilds its folder from it after an edit", async () => {
    const name = aName("tdd");
    await anOnSkill(name, "Red, green.");
    const sessionId = randomUUID();
    const prepared = await sessionSkills.prepare({
      sessionId,
      roleSkills: [name],
      project: undefined,
    });
    await library.edit(name, { description: `Uses ${name}.`, instructions: "Refactor too." });
    await library.turnOn(name);
    await writeFile(join(prepared.folder, "skills", name, "SKILL.md"), "changed by an Agent");

    const rebuilt = await sessionSkills.rebuild(sessionId);

    expect(rebuilt).toEqual(prepared);
    expect(rebuilt.versions).toEqual([{ name, version: 1, filesHash: expect.any(String) }]);
    expect(await readFile(join(rebuilt.folder, "skills", name, "SKILL.md"), "utf8")).toContain(
      "Red, green.",
    );
    const next = await sessionSkills.prepare({
      sessionId: randomUUID(),
      roleSkills: [name],
      project: undefined,
    });
    expect(next.versions).toEqual([{ name, version: 2, filesHash: expect.any(String) }]);
  });

  it("refuses to rebuild a session it has no record of", async () => {
    await expect(sessionSkills.rebuild(randomUUID())).rejects.toThrow(SessionSkillsNotFound);
  });

  describe("cleanup", () => {
    it("removes a session's folder and record once it can't be resumed", async () => {
      const sessionId = randomUUID();
      await sessionSkills.prepare({ sessionId, roleSkills: [], project: undefined });

      await sessionSkills.forget(sessionId);

      expect(await readdir(join(officeData, "sessions"))).toEqual([]);
      await expect(sessionSkills.rebuild(sessionId)).rejects.toThrow(SessionSkillsNotFound);
    });

    it("keeps a removed skill's version while a session that got it can be resumed", async () => {
      const name = aName("tdd");
      await anOnSkill(name);
      const kept = randomUUID();
      const forgotten = randomUUID();
      await sessionSkills.prepare({ sessionId: kept, roleSkills: [name], project: undefined });
      await sessionSkills.prepare({ sessionId: forgotten, roleSkills: [name], project: undefined });
      await library.remove(name);
      await sessionSkills.forget(forgotten);

      await sessionSkills.sweep();

      await expect(sessionSkills.rebuild(kept)).resolves.toMatchObject({
        names: [`office:${name}`],
      });
      await sessionSkills.forget(kept);
      await sessionSkills.sweep();
      expect(await readdir(join(officeData, "skills"))).not.toContain(name);
    });

    it("drops a skill's earlier versions that no session needs", async () => {
      const name = aName("tdd");
      await anOnSkill(name, "First.");
      await library.edit(name, { description: `Uses ${name}.`, instructions: "Second." });

      await sessionSkills.sweep();

      expect(await readdir(join(officeData, "skills", name))).toHaveLength(1);
      expect((await library.review(name)).instructions).toBe("Second.");
    });

    it("removes, at the service's start, the folders of sessions with no record", async () => {
      const recorded = randomUUID();
      await sessionSkills.prepare({ sessionId: recorded, roleSkills: [], project: undefined });
      await mkdir(join(officeData, "sessions", "orphan", "skills"), { recursive: true });
      await app.close();

      await start();

      expect(await readdir(join(officeData, "sessions"))).toEqual([recorded]);
    });

    it("fails a rebuild when the library lost a version the session got", async () => {
      const name = aName("tdd");
      await anOnSkill(name);
      const sessionId = randomUUID();
      await sessionSkills.prepare({ sessionId, roleSkills: [name], project: undefined });
      await rm(join(officeData, "skills", name), { recursive: true, force: true });

      await expect(sessionSkills.rebuild(sessionId)).rejects.toThrow(SkillVersionMissing);
    });
  });
});
