import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import { EngineModule, EngineSessions } from "../../engine/index.js";
import {
  createProjectCheckout,
  projectSkillMd,
  type ProjectCheckout,
} from "../adapters/git/project-checkout.fixtures.js";
import { SessionSkillsNotFound } from "../domain/session-skills-not-found.js";
import { SkillVersionMissing } from "../domain/skill-version-missing.js";
import { SkillsModule } from "../skills.module.js";
import { RoleSkills } from "./role-skills.js";
import { SessionSkills, type PreparedSkills } from "./session-skills.js";
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

/** A name of the test's own, since every test file shares the database. */
function aName(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** A Role of the test's own, given the skills. */
async function aRoleWith(...skillNames: string[]): Promise<string> {
  const roleKey = aName("role");
  await app.get(RoleSkills).assignToRole(roleKey, skillNames);
  return roleKey;
}

async function anOnSkill(name: string, instructions = "Do it."): Promise<void> {
  await library.write({ name, description: `Uses ${name}.`, instructions });
  await library.turnOn(name);
}

function sessionFolder(sessionId: string): string {
  return join(officeData, "sessions", sessionId, "skills");
}

describe("SessionSkills", () => {
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
        roleKey: await aRoleWith(tdd),
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
      roleKey: aName("role"),
      project: { folder: checkout.path, useProjectSkills: false },
    });

    expect(prepared.names).toEqual([]);
    expect(prepared.expected).toEqual([]);
    expect(prepared.overrides).toEqual({ deploy: "off", ship: "off" });
  });

  it("gives a Role's next session a skill assigned from Settings, and none taken away", async () => {
    const [kept, taken] = [aName("tdd"), aName("grilling")];
    await anOnSkill(kept);
    await anOnSkill(taken);
    const roleKey = await aRoleWith(taken);
    const roleSkills = app.get(RoleSkills);
    await roleSkills.assignSkill(kept, [roleKey]);
    await roleSkills.assignSkill(taken, []);

    const prepared = await sessionSkills.prepare({
      sessionId: randomUUID(),
      roleKey,
      project: undefined,
    });

    expect(prepared.versions.map((skill) => skill.name)).toEqual([kept]);
  });

  it("reports an allowed Project skill that also allows a library skill by its suffix", async () => {
    const name = aName("deploy");
    await checkout.write(`.claude/skills/${name}/SKILL.md`, projectSkillMd(name, "Theirs."));
    await anOnSkill(name);

    const prepared = await sessionSkills.prepare({
      sessionId: randomUUID(),
      roleKey: await aRoleWith(name),
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
      roleKey: await aRoleWith(name),
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
      roleKey: await aRoleWith(name),
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
      await sessionSkills.prepare({ sessionId, roleKey: aName("role"), project: undefined });

      await sessionSkills.forget(sessionId);

      expect(await readdir(join(officeData, "sessions"))).toEqual([]);
      await expect(sessionSkills.rebuild(sessionId)).rejects.toThrow(SessionSkillsNotFound);
    });

    it("keeps a removed skill's version while a session that got it can be resumed", async () => {
      const name = aName("tdd");
      await anOnSkill(name);
      const kept = randomUUID();
      const forgotten = randomUUID();
      await sessionSkills.prepare({
        sessionId: kept,
        roleKey: await aRoleWith(name),
        project: undefined,
      });
      await sessionSkills.prepare({
        sessionId: forgotten,
        roleKey: await aRoleWith(name),
        project: undefined,
      });
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
      await sessionSkills.prepare({
        sessionId: recorded,
        roleKey: aName("role"),
        project: undefined,
      });
      await mkdir(join(officeData, "sessions", "orphan", "skills"), { recursive: true });
      await app.close();

      await start();

      expect(await readdir(join(officeData, "sessions"))).toEqual([recorded]);
    });

    it("fails a rebuild when the library lost a version the session got", async () => {
      const name = aName("tdd");
      await anOnSkill(name);
      const sessionId = randomUUID();
      await sessionSkills.prepare({
        sessionId,
        roleKey: await aRoleWith(name),
        project: undefined,
      });
      await rm(join(officeData, "skills", name), { recursive: true, force: true });

      await expect(sessionSkills.rebuild(sessionId)).rejects.toThrow(SkillVersionMissing);
    });
  });
});

/**
 * Task 07's check on the Test Project (docs/tasks/07-skills.md): a skill written, reviewed, turned
 * on and given to everyone; a session in a worktree of the Test Project, with a Project skill of
 * its own, that lists exactly those two; the context the listing costs; and an edit that the next
 * session gets while the first keeps its version. Live sessions, so it runs only when asked:
 * OFFICE_ENGINE_TESTS=live and OFFICE_TEST_PROJECT=<the Test Project's folder>.
 *
 * A skill on and for everyone reaches every session prepared on the shared database, so this check
 * sits in this file, whose tests run one at a time, and keeps its skill on only while a session
 * of its own is prepared.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"];
const run = promisify(execFile);

const PROJECT_SKILL = "admin-notes";
const BRIEF = "Reply with the single word: ready";

describe.runIf(MODE === "live" && TEST_PROJECT !== undefined)(
  "Task 07's check on the Test Project",
  () => {
    it("gives a session exactly its skill for everyone and the Project's, and keeps its version", async () => {
      const project = TEST_PROJECT ?? "";
      const folder = await mkdtemp(join(tmpdir(), "office-skills-check-"));
      const worktree = join(folder, "worktree");
      const git = (...args: string[]) => run("git", args, { cwd: project });
      await git("worktree", "add", "--detach", worktree, "HEAD");
      // Untracked in the worktree only: the Test Project itself is left as it is.
      await mkdir(join(worktree, ".claude", "skills", PROJECT_SKILL), { recursive: true });
      await writeFile(
        join(worktree, ".claude", "skills", PROJECT_SKILL, "SKILL.md"),
        `---\nname: ${PROJECT_SKILL}\ndescription: Notes on the admin panel's layout.\n---\nRead the README first.\n`,
      );
      const { app: checkApp } = await startTestApplication({
        database: true,
        imports: [
          EventsModule,
          EventStreamModule,
          TelemetryModule,
          OfficeDataModule.forRoot(join(folder, "office-data")),
          SkillsModule,
          EngineModule,
        ],
      });
      const checkLibrary = checkApp.get(SkillLibrary);
      const skill = `release-notes-${randomUUID().slice(0, 8)}`;
      try {
        await checkLibrary.write({
          name: skill,
          description: "Writes the release notes from the merged pull requests.",
          instructions: "Group them as Added, Changed and Fixed, one line each.",
        });
        const review = await checkLibrary.review(skill);
        expect(review.files.map((file) => file.path)).toEqual(["SKILL.md"]);
        expect(review.warnings).toEqual([]);
        await checkLibrary.changeEveryone(skill, true);

        const first = await preparedWhileOn(checkApp, skill, worktree);
        expect(first.expected).toEqual([PROJECT_SKILL, `office:${skill}`]);
        const withSkills = await firstTurnTokens(checkApp, first, worktree);
        const without = await firstTurnTokens(checkApp, undefined, worktree);
        console.info(
          `Task 07 check: the first call took ${withSkills} tokens with office:${skill} and ${PROJECT_SKILL}, ${without} without skills; the listing costs ${withSkills - without}.`,
        );
        expect(withSkills).toBeGreaterThan(without);

        await checkLibrary.edit(skill, {
          description: "Writes the release notes from the merged pull requests.",
          instructions: "Group them as Added, Changed and Fixed, in the past tense.",
        });
        const next = await preparedWhileOn(checkApp, skill, worktree);
        expect(first.versions).toEqual([
          { name: skill, version: 1, filesHash: expect.any(String) },
        ]);
        expect(next.versions).toEqual([{ name: skill, version: 2, filesHash: expect.any(String) }]);
        console.info(
          `Task 07 check: the first session recorded ${skill} v1, the session after the edit v2.`,
        );
      } finally {
        await checkLibrary.remove(skill).catch(() => undefined);
        await checkApp.close();
        await git("worktree", "remove", "--force", worktree);
        await rm(folder, { recursive: true, force: true });
      }
    }, 300_000);
  },
);

/** A new session's skills, prepared while `skill` is on: turning it on is its review. */
async function preparedWhileOn(
  on: INestApplication,
  skill: string,
  worktree: string,
): Promise<PreparedSkills> {
  const skills = on.get(SkillLibrary);
  await skills.turnOn(skill);
  try {
    return await on.get(SessionSkills).prepare({
      sessionId: randomUUID(),
      roleKey: aName("role"),
      project: { folder: worktree, useProjectSkills: true },
    });
  } finally {
    await skills.turnOff(skill);
  }
}

/** The tokens of a new session's first call, which the start check let start. */
async function firstTurnTokens(
  on: INestApplication,
  skills: PreparedSkills | undefined,
  worktree: string,
): Promise<number> {
  const session = await on.get(EngineSessions).start({
    id: randomUUID(),
    settings: {
      engine: "agent-sdk",
      folder: worktree,
      environment: Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      model: "claude-haiku-5-5",
      effort: "low",
      skills: skills && {
        folder: skills.folder,
        names: skills.names,
        expected: skills.expected,
        overrides: skills.overrides,
      },
      profile: { edit: false, run: { kind: "read-only-git" }, web: false },
      officeTools: [],
      mcpServers: [],
      instructions: "",
      outputSchema: undefined,
    },
    brief: { id: randomUUID(), text: BRIEF },
  });
  try {
    for await (const event of session.events) {
      if (event.kind === "turn-ended") {
        const { input, cacheRead, cacheCreation } = event.usage;
        return input + cacheRead + cacheCreation;
      }
    }
    throw new Error(`Session ${session.id} ended before its turn did.`);
  } finally {
    await session.end();
  }
}
