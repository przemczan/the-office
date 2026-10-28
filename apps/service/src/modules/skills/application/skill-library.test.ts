import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import {
  createSourceRepository,
  sourceSkillMd,
  type SourceRepository,
} from "../adapters/git/source-repository.fixtures.js";
import { SkillAdded } from "../domain/skill-events.js";
import { skillFilesHash } from "../domain/skill-files.js";
import { SkillRefused } from "../domain/skill-refused.js";
import { SkillsModule } from "../skills.module.js";
import { SkillLibrary, type SkillInstall } from "./skill-library.js";

/** git on Windows is slow while every test file runs at once. */
const GIT_TEST_TIMEOUT_MS = 30_000;

let officeData: string;
let app: INestApplication;
let library: SkillLibrary;
let source: SourceRepository;
let published: DomainEvent[];

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-skills-"));
  ({ app } = await startTestApplication({
    database: true,
    imports: [EventsModule, EventStreamModule, OfficeDataModule.forRoot(officeData), SkillsModule],
  }));
  library = app.get(SkillLibrary);
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
  source = await createSourceRepository();
});

afterEach(async () => {
  await app.close();
  await source.remove();
  await rm(officeData, { recursive: true, force: true });
});

/** A name of the test's own, since every test file shares the database. */
function aName(): string {
  return `notes-${randomUUID().slice(0, 8)}`;
}

async function reasonsOf(promise: Promise<unknown>): Promise<readonly string[]> {
  const refusal = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(refusal).toBeInstanceOf(SkillRefused);
  return (refusal as SkillRefused).reasons;
}

describe("install", { timeout: GIT_TEST_TIMEOUT_MS }, () => {
  it("fetches the skill at its pinned tag into the library, off until reviewed", async () => {
    const name = aName();
    await source.write(`skills/${name}/SKILL.md`, sourceSkillMd("Writes release notes."));
    await source.write(`skills/${name}/template.md`, "## Added\n");
    const commit = source.commit();
    source.tag("v1.0.0", "annotated");
    await source.write(`skills/${name}/template.md`, "## Changed\n");
    source.commit();
    const install: SkillInstall = {
      repository: source.url,
      folder: `skills/${name}`,
      pinnedVersion: { tag: "v1.0.0", commit },
    };

    const skill = await library.install(install);

    expect(skill).toMatchObject({
      name,
      description: "Writes release notes.",
      source: "installed",
      installedFrom: install,
      version: 1,
      state: "waiting-for-review",
      everyone: false,
    });
    expect(await library.read(name)).toEqual(skill);
    const review = await library.review(name);
    expect(review.files.map((file) => [file.path, file.text])).toEqual([
      ["SKILL.md", sourceSkillMd("Writes release notes.")],
      ["template.md", "## Added\n"],
    ]);
    expect(published).toEqual([new SkillAdded(skill)]);
  });

  it("fetches a pinned commit when the source has no tags, its top folder named by its SKILL.md", async () => {
    const name = aName();
    await source.write("SKILL.md", sourceSkillMd("Notes.", name));
    const commit = source.commit();

    const skill = await library.install({
      repository: ` ${source.url} `,
      folder: "",
      pinnedVersion: { commit },
    });

    expect(skill.name).toBe(name);
    expect(skill.installedFrom).toEqual({
      repository: source.url,
      folder: "",
      pinnedVersion: { commit },
    });
  });

  it("checks the files against the hash they were proposed with", async () => {
    const name = aName();
    await source.write(`${name}/SKILL.md`, sourceSkillMd("Notes."));
    const commit = source.commit();
    const install = { repository: source.url, folder: name, pinnedVersion: { commit } };

    expect(await reasonsOf(library.install({ ...install, filesHash: "other" }))).toEqual([
      `${name}'s files at ${source.url} are not the ones proposed.`,
    ]);
    const filesHash = skillFilesHash([
      { path: "SKILL.md", content: new TextEncoder().encode(sourceSkillMd("Notes.")) },
    ]);
    expect((await library.install({ ...install, filesHash })).filesHash).toBe(filesHash);
  });

  it("refuses a name the library already has", async () => {
    const name = aName();
    await library.write({ name, description: "Mine.", instructions: "Do it." });
    await source.write(`${name}/SKILL.md`, sourceSkillMd("Theirs."));
    const commit = source.commit();

    expect(
      await reasonsOf(
        library.install({ repository: source.url, folder: name, pinnedVersion: { commit } }),
      ),
    ).toEqual([`The library already has ${name}.`]);
  });

  it("refuses a source that can't be fetched, a folder with no skill and files the library refuses", async () => {
    const name = aName();
    await source.write(`${name}/SKILL.md`, "No frontmatter.");
    const commit = source.commit();
    const missing = pathToFileURL(join(officeData, "missing.git")).href;

    expect(
      await reasonsOf(
        library.install({ repository: missing, folder: "", pinnedVersion: { commit } }),
      ),
    ).toEqual([expect.stringMatching(new RegExp(`^Could not read ${missing}: .+`))]);
    expect(
      await reasonsOf(
        library.install({ repository: source.url, folder: "other", pinnedVersion: { commit } }),
      ),
    ).toEqual([`${source.url} has no skill in "other" at ${commit.slice(0, 7)}.`]);
    expect(
      await reasonsOf(
        library.install({ repository: source.url, folder: name, pinnedVersion: { commit } }),
      ),
    ).toEqual([expect.stringContaining("SKILL.md")]);
    expect(
      await reasonsOf(
        library.install({ repository: "--upload-pack=x", folder: "", pinnedVersion: { commit } }),
      ),
    ).toHaveLength(1);
  });

  it("keeps an installed skill from being edited or uploaded over", async () => {
    const name = aName();
    await source.write(`${name}/SKILL.md`, sourceSkillMd("Notes."));
    const commit = source.commit();
    await library.install({ repository: source.url, folder: name, pinnedVersion: { commit } });
    const refusal = `${name} was installed from ${source.url}; it changes by an update Proposal.`;

    expect(
      await reasonsOf(library.edit(name, { description: "Mine.", instructions: "Do it." })),
    ).toEqual([refusal]);
    expect(
      await reasonsOf(
        library.uploadVersion(name, {
          fileName: `${name}.md`,
          content: new TextEncoder().encode(sourceSkillMd("Mine.")),
        }),
      ),
    ).toEqual([refusal]);
  });
});
