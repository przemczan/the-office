import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
import { proposalListSchema, skillSchema, skillUpdateDiffSchema } from "@the-office/contracts";
import type { Proposal } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { GITHUB_SITE } from "../../../platform/config/github-site.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { EngineModule, ScriptedEngine, ScriptedEngineModule } from "../../engine/index.js";
import { EngineCascade, RoleCards } from "../../people/index.js";
import { EngineCascadeStandIn } from "../../people/index.fixtures.js";
import { ownProjectsStartedTasks } from "../../pipelines/index.fixtures.js";
import {
  SKILL_UPDATE_CHECK,
  SkillLibrary,
  SkillSources,
  SkillUpdates,
} from "../../skills/index.js";
import { ownSources } from "../../skills/index.fixtures.js";
import { ownProjectsQueue } from "../../work/index.fixtures.js";
import {
  aSkillName,
  DevopsChat,
  NINA_DUTIES,
  NINA_ROLE_CARDS,
} from "../adapters/http/devops-chat.fixtures.js";
import { LIST_SOURCE_SKILLS_TOOL, READ_SKILL_UPDATE_TOOL } from "../domain/session-instructions.js";
import { ProjectBases } from "../ports/project-bases.js";
import { noProjectBases } from "../ports/project-bases.fixtures.js";
import { sessionMemoryProvider } from "./session-memory.fixtures.js";

// Devops' other Proposals, and skills drafted in a chat, are devops-proposals.test.ts. Installing and
// updating a skill are the Office actions install_skill and update_skill now; a Proposal drafted by
// the retired propose_skill_install and propose_skill_update still applies, which these test.

const run = promisify(execFile);

let folder: string;
let app: INestApplication;
let url: string;
let chat: DevopsChat;
/** The test's own Sources (`aSource`): no other is read, so its update check reads no other file's. */
let ownSourceUrls: string[];

/** The whole app boots for each test: slow under a full run. */
const BOOT_TIMEOUT_MS = 30_000;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-devops-skill-sources-"));
  // The test's own, as DevopsChat says.
  const engine = new ScriptedEngine([]);
  ownSourceUrls = [];
  ({ app, url } = await startTestApplication({
    imports: [
      AppModule.register(
        {
          host: "127.0.0.1",
          port: 0,
          databaseUrl: testDatabaseUrl(),
          officeDataDirectory: join(folder, "office-data"),
          gitHub: GITHUB_SITE,
        },
        { directory: folder, source: "built" },
      ),
    ],
    overrides: [
      { provide: RoleCards, useValue: NINA_ROLE_CARDS },
      NINA_DUTIES,
      { provide: EngineCascade, useValue: new EngineCascadeStandIn() },
      // Nina's Memory is People's, kept by her Role, which the stand-in above has no row for.
      sessionMemoryProvider(),
      // A chat reads every Project's base branch, which would run git in other test files' own
      // repositories on the shared database while they use or delete them; no test here needs it.
      { provide: ProjectBases, useValue: noProjectBases(join(folder, "bases")) },
      // The queue and the started Tasks every file shares: this file queues nothing and starts
      // nothing, so neither its releases nor its start touch other files' Tasks.
      ownProjectsQueue(),
      ownProjectsStartedTasks(),
      ownSources(() => ownSourceUrls),
    ],
    moduleOverrides: [{ module: EngineModule, useModule: ScriptedEngineModule.register(engine) }],
  }));
  chat = new DevopsChat(app, url, engine);
}, BOOT_TIMEOUT_MS);

afterEach(async () => {
  await app.close();
  await rm(folder, { recursive: true, force: true });
});

/** A Proposal of installing `folder` of `source`, as the retired propose_skill_install drafted it. */
async function draftsInstall(
  source: { readonly url: string },
  skillFolder: string,
): Promise<Proposal> {
  const read = await app.get(SkillSources, { strict: false }).skills(source.url, skillFolder);
  const [skill] = read.skills;
  if (!skill || "problems" in skill) throw new Error(`${skillFolder} holds no skill.`);
  return chat.ninaDrafts({
    kind: "skill-install",
    repository: read.repository,
    folder: skill.folder,
    pinnedVersion: read.pinnedVersion,
    name: skill.name,
    description: skill.description,
    files: skill.files,
    filesHash: skill.filesHash,
  });
}

/** A Proposal of updating `skill`, as the retired propose_skill_update drafted it. */
async function draftsUpdate(skill: string, notes: string): Promise<Proposal> {
  const draft = await app.get(SkillUpdates, { strict: false }).draft(skill);
  return chat.ninaDrafts({
    kind: "skill-update",
    name: draft.name,
    repository: draft.repository,
    folder: draft.folder,
    from: draft.from,
    to: draft.to,
    notes,
    files: draft.files,
    filesHash: draft.filesHash,
  });
}

/** Each reads a Source with several git calls, through list, propose and apply: slow under a full run. */
const INSTALL_TEST_TIMEOUT_MS = 90_000;

describe("Devops installing a skill from a source, through the scripted engine", () => {
  it(
    "lists a source's skills, and a Proposal of installing one applies: it is in the library at its pinned tag, off until reviewed",
    async () => {
      const name = aSkillName();
      const source = await aSource([name, aSkillName()]);

      const listed = await chat.ninaCalls(LIST_SOURCE_SKILLS_TOOL, { source: source.url });

      expect(listed.isError).toBe(false);
      expect(JSON.parse(listed.text)).toMatchObject({
        repository: source.url,
        pinnedVersion: { tag: "v1.0.0", commit: source.commit },
        skills: expect.arrayContaining([
          {
            folder: `skills/${name}`,
            name,
            description: `Writes ${name}.`,
            files: ["SKILL.md", "scripts/run.sh"],
            filesHash: expect.any(String),
          },
        ]),
      });

      const proposal = await draftsInstall(source, `skills/${name}`);

      expect(proposal.change).toEqual({
        kind: "skill-install",
        repository: source.url,
        folder: `skills/${name}`,
        pinnedVersion: { tag: "v1.0.0", commit: source.commit },
        name,
        description: `Writes ${name}.`,
        files: ["SKILL.md", "scripts/run.sh"],
        filesHash: expect.any(String),
      });
      const response = await chat.api("POST", `/proposals/${proposal.id}/apply`, {});
      expect(response.status).toBe(200);
      expect(skillSchema.parse(await chat.read(`/skills/${name}`))).toMatchObject({
        name,
        source: "installed",
        installedFrom: {
          repository: source.url,
          folder: `skills/${name}`,
          pinnedVersion: { tag: "v1.0.0", commit: source.commit },
        },
        state: "waiting-for-review",
        everyone: false,
      });
    },
    INSTALL_TEST_TIMEOUT_MS,
  );

  it(
    "installs at the newest commit from a source with no tags",
    async () => {
      const name = aSkillName();
      const source = await aSource([name], { tagged: false });

      const proposal = await draftsInstall(source, `skills/${name}`);

      expect(proposal.change).toMatchObject({ pinnedVersion: { commit: source.commit } });
      expect(proposal.change).not.toHaveProperty("pinnedVersion.tag");
      const response = await chat.api("POST", `/proposals/${proposal.id}/apply`, {});
      expect(response.status).toBe(200);
      expect(skillSchema.parse(await chat.read(`/skills/${name}`)).installedFrom).toEqual({
        repository: source.url,
        folder: `skills/${name}`,
        pinnedVersion: { commit: source.commit },
      });
    },
    INSTALL_TEST_TIMEOUT_MS,
  );

  it(
    "refuses installing once the name is taken or the source can't be read; the Proposal stays open",
    async () => {
      const taken = aSkillName();
      const gone = aSkillName();
      const source = await aSource([taken, gone]);
      const first = await draftsInstall(source, `skills/${taken}`);
      const second = await draftsInstall(source, `skills/${gone}`);
      await chat.api("POST", "/skills", {
        name: taken,
        description: "Mine.",
        instructions: "Do it.",
      });
      const refusedTaken = await chat.api("POST", `/proposals/${first.id}/apply`, {});
      await rm(source.folder, { recursive: true, force: true, maxRetries: 5 });
      const refusedGone = await chat.api("POST", `/proposals/${second.id}/apply`, {});

      expect(await chat.reasonsOf(refusedTaken)).toEqual([`The library already has ${taken}.`]);
      const [goneReason] = await chat.reasonsOf(refusedGone);
      expect(goneReason?.startsWith(`Could not read ${source.url}: `)).toBe(true);
      expect((await chat.readProposal(first.id)).status.kind).toBe("open");
      expect((await chat.readProposal(second.id)).status.kind).toBe("open");
      expect((await fetch(`${url}/api/skills/${gone}`)).status).toBe(404);
    },
    INSTALL_TEST_TIMEOUT_MS,
  );
});

describe("Devops updating an installed skill, through the scripted engine", () => {
  it(
    "finds the update daily, reads its diff, and a Proposal of it with notes applies: the skill is pinned there and stays on, and a stale one is refused",
    async () => {
      const name = aSkillName();
      const source = await aSource([name]);
      await app.get(SkillLibrary, { strict: false }).install({
        repository: source.url,
        folder: `skills/${name}`,
        pinnedVersion: { tag: "v1.0.0", commit: source.commit },
      });
      expect((await chat.api("PUT", `/skills/${name}/state`, { state: "on" })).status).toBe(200);
      const commit = await source.release("v1.1.0", {
        [`skills/${name}/SKILL.md`]: `---\ndescription: Writes ${name}.\n---\nDo it twice.\n`,
      });
      const to = { tag: "v1.1.0", commit };

      await (app.get(Schedule, { strict: false }) as ManualSchedule).runDaily(SKILL_UPDATE_CHECK);
      expect(skillSchema.parse(await chat.read(`/skills/${name}`)).update).toEqual(to);

      const readUpdate = await chat.ninaCalls(READ_SKILL_UPDATE_TOOL, { skill: name });
      expect(readUpdate.isError).toBe(false);
      expect(JSON.parse(readUpdate.text)).toMatchObject({
        name,
        from: { tag: "v1.0.0", commit: source.commit },
        to,
        files: ["SKILL.md", "scripts/run.sh"],
        diff: expect.stringContaining("+Do it twice."),
        diffCut: false,
      });

      const proposal = await draftsUpdate(name, "Does it twice.");
      const stale = await draftsUpdate(name, "The same, again.");
      expect(proposal.change).toEqual({
        kind: "skill-update",
        name,
        repository: source.url,
        folder: `skills/${name}`,
        from: { tag: "v1.0.0", commit: source.commit },
        to,
        notes: "Does it twice.",
        files: ["SKILL.md", "scripts/run.sh"],
        filesHash: expect.any(String),
        appliedDiff: null,
      });
      const diff = skillUpdateDiffSchema.parse(
        await chat.read(
          `/skills/${name}/update-diff?fromTag=v1.0.0&fromCommit=${source.commit}&toTag=v1.1.0&toCommit=${commit}`,
        ),
      );
      expect(diff.diff).toContain("--- a/SKILL.md");
      expect(diff.diff).toContain("-Do it.\n+Do it twice.");

      expect((await chat.api("POST", `/proposals/${proposal.id}/apply`, {})).status).toBe(200);
      const updated = skillSchema.parse(await chat.read(`/skills/${name}`));
      expect(updated).toMatchObject({ version: 2, state: "on" });
      expect(updated.installedFrom?.pinnedVersion).toEqual(to);
      expect(updated.update).toBeUndefined();
      // Kept as applied: the card shows it without the Source.
      expect((await chat.readProposal(proposal.id ?? "")).change).toMatchObject({
        appliedDiff: { diff: diff.diff, diffCut: false },
      });

      expect(
        await chat.reasonsOf(await chat.api("POST", `/proposals/${stale.id}/apply`, {})),
      ).toEqual([
        `${name} is pinned at v1.1.0 now, not at v1.0.0 as this update was proposed from.`,
      ]);
      expect((await chat.readProposal(stale.id)).status.kind).toBe("open");
      const open = proposalListSchema.parse(await chat.read("/proposals/open")).map(({ id }) => id);
      expect(open).toContain(stale.id);
      expect(open).not.toContain(proposal.id);
    },
    INSTALL_TEST_TIMEOUT_MS * 2,
  );
});

interface SourceForTest {
  readonly url: string;
  readonly folder: string;
  readonly commit: string;
  /** Writes the files at their paths, commits, tags the commit and pushes both; its id. */
  release(tag: string, files: Readonly<Record<string, string>>): Promise<string>;
}

/**
 * A Source of the test's own: a bare repository with a skill in `skills/<name>` for each name,
 * tagged v1.0.0 unless `tagged` is false, and a skill with no description in `undescribed` when
 * given; reached by a file URL so the test never uses the network.
 */
async function aSource(
  names: readonly string[],
  { tagged = true, undescribed }: { readonly tagged?: boolean; readonly undescribed?: string } = {},
): Promise<SourceForTest> {
  const checkout = await mkdtemp(join(folder, "source-"));
  const git = (...gitArguments: string[]) =>
    run("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...gitArguments], {
      cwd: checkout,
    });
  await git("init", "--initial-branch=main");
  for (const name of names) {
    await mkdir(join(checkout, "skills", name, "scripts"), { recursive: true });
    await writeFile(
      join(checkout, "skills", name, "SKILL.md"),
      `---\ndescription: Writes ${name}.\n---\nDo it.\n`,
    );
    await writeFile(join(checkout, "skills", name, "scripts", "run.sh"), "#!/bin/sh\n");
  }
  if (undescribed !== undefined) {
    await mkdir(join(checkout, ...undescribed.split("/")), { recursive: true });
    await writeFile(
      join(checkout, ...undescribed.split("/"), "SKILL.md"),
      "---\nlicense: MIT\n---\nDo it.\n",
    );
  }
  await git("add", ".");
  await git("commit", "-m", "Skills");
  if (tagged) await git("tag", "--annotate", "--message", "First", "v1.0.0");
  const bare = `${checkout}.git`;
  await run("git", ["clone", "--bare", "--quiet", checkout, bare]);
  ownSourceUrls.push(pathToFileURL(bare).href);
  const head = async () =>
    (await run("git", ["rev-parse", "HEAD"], { cwd: checkout })).stdout.trim();
  return {
    url: pathToFileURL(bare).href,
    folder: bare,
    commit: await head(),
    async release(tag, files) {
      for (const [path, content] of Object.entries(files)) {
        await writeFile(join(checkout, ...path.split("/")), content);
      }
      await git("commit", "--all", "-m", tag);
      await git("tag", "--annotate", "--message", tag, tag);
      await git("push", "--quiet", bare, "main", `refs/tags/${tag}`);
      return head();
    },
  };
}
