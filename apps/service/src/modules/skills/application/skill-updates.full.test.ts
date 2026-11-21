import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import { OfficeIdentity } from "../../../platform/git-identity/office-identity.js";
import {
  createSourceRepository,
  sourceSkillMd,
  type SourceRepository,
} from "../adapters/git/source-repository.fixtures.js";
import { OwnSourcesFetcher } from "../adapters/git/git-source-fetcher.fixtures.js";
import type { PinnedVersion, RemoteRef } from "../domain/installed-source.js";
import { SourceFetcher } from "../ports/source-fetcher.js";
import { SkillUpdateFound, SkillUpdateGone } from "../domain/skill-events.js";
import { SkillsModule } from "../skills.module.js";
import { SkillLibrary } from "./skill-library.js";
import { SKILL_UPDATE_CHECK } from "./skill-updates.js";

/** git on Windows is slow while every test file runs at once. */
const GIT_TEST_TIMEOUT_MS = 30_000;

let officeData: string;
let app: INestApplication;
let library: SkillLibrary;
let schedule: ManualSchedule;
let source: SourceRepository;
let published: DomainEvent[];
let fetcher: SourceFetcherWithAFailure;
/** The test's own Sources: no other is read, so no other file's skills are checked here. */
let ownSourceUrls: string[];

/** The test's own Sources, but reading the refs of `failingUrl` fails as nothing foreseen does. */
class SourceFetcherWithAFailure extends OwnSourcesFetcher {
  failingUrl: string | undefined = undefined;

  override async refs(url: string): Promise<readonly RemoteRef[]> {
    if (url === this.failingUrl) throw new Error("Something unforeseen.");
    return super.refs(url);
  }
}

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-skill-updates-"));
  schedule = new ManualSchedule();
  ownSourceUrls = [];
  ({ app } = await startTestApplication({
    database: true,
    imports: [EventsModule, EventStreamModule, OfficeDataModule.forRoot(officeData), SkillsModule],
    overrides: [
      { provide: Schedule, useValue: schedule },
      {
        provide: SourceFetcher,
        useFactory: (identity: OfficeIdentity) =>
          new SourceFetcherWithAFailure(identity, () => ownSourceUrls),
        inject: [OfficeIdentity],
      },
    ],
  }));
  fetcher = app.get<SourceFetcherWithAFailure>(SourceFetcher);
  library = app.get(SkillLibrary);
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
  source = await createSourceRepository();
  ownSourceUrls.push(source.url);
});

afterEach(async () => {
  await app.close();
  await source.remove();
  await rm(officeData, { recursive: true, force: true });
});

/** Installs a skill of the test's own from the Source, pinned at `tag` or untagged; returns its name. */
async function installed(tag?: string): Promise<string> {
  const name = `notes-${randomUUID().slice(0, 8)}`;
  await source.write(`${name}/SKILL.md`, sourceSkillMd("Notes.", name));
  const commit = source.commit();
  if (tag !== undefined) source.tag(tag);
  const pinnedVersion: PinnedVersion = { ...(tag !== undefined && { tag }), commit };
  await library.install({ repository: source.url, folder: name, pinnedVersion });
  published = [];
  return name;
}

function updateEvents(name: string): DomainEvent[] {
  return published.filter(
    (event) =>
      (event instanceof SkillUpdateFound || event instanceof SkillUpdateGone) &&
      event.skillName === name,
  );
}

describe("the daily update check", { timeout: GIT_TEST_TIMEOUT_MS }, () => {
  it("marks an installed skill whose Source has a newer tag, and announces it once", async () => {
    const name = await installed("v1.9");
    await source.write("CHANGELOG.md", "v1.10\n");
    const newer = source.commit();
    source.tag("v1.10", "annotated");

    await schedule.runDaily(SKILL_UPDATE_CHECK);
    await schedule.runDaily(SKILL_UPDATE_CHECK);

    const update = { tag: "v1.10", commit: newer };
    expect((await library.read(name)).update).toEqual(update);
    expect(updateEvents(name)).toEqual([expect.any(SkillUpdateFound)]);
    expect(updateEvents(name)[0]).toMatchObject({ skillName: name, update });
  });

  it("lists by name the skills with an update found, for Now", async () => {
    const outdated = await installed("v1.9");
    await source.write("CHANGELOG.md", "v1.10\n");
    source.commit();
    source.tag("v1.10");
    const newest = await installed("v1.11");

    await schedule.runDaily(SKILL_UPDATE_CHECK);

    const withUpdate = await library.withUpdate();
    expect(withUpdate).toContain(outdated);
    expect(withUpdate).not.toContain(newest);
  });

  it("finds no update while the pinned version is the Source's newest", async () => {
    const name = await installed("v2.0.0");
    await source.write("CHANGELOG.md", "beta\n");
    source.commit();
    source.tag("v2.0.0-beta");

    await schedule.runDaily(SKILL_UPDATE_CHECK);

    expect((await library.read(name)).update).toBeUndefined();
    expect(updateEvents(name)).toEqual([]);
  });

  it("finds a newer commit of a Source with no tags", async () => {
    const name = await installed();
    await source.write("CHANGELOG.md", "more\n");
    const newer = source.commit();

    await schedule.runDaily(SKILL_UPDATE_CHECK);

    expect((await library.read(name)).update).toEqual({ commit: newer });
  });

  it("clears the update once its Source no longer has it", async () => {
    const name = await installed("v1");
    await source.write("CHANGELOG.md", "v2\n");
    source.commit();
    source.tag("v2");
    await schedule.runDaily(SKILL_UPDATE_CHECK);
    source.untag("v2");

    await schedule.runDaily(SKILL_UPDATE_CHECK);

    expect((await library.read(name)).update).toBeUndefined();
    expect(updateEvents(name).at(-1)).toBeInstanceOf(SkillUpdateGone);
  });

  it("keeps what it found when the Source can't be read", async () => {
    const name = await installed("v1");
    await source.write("CHANGELOG.md", "v2\n");
    const newer = source.commit();
    source.tag("v2");
    await schedule.runDaily(SKILL_UPDATE_CHECK);
    await source.remove();

    await schedule.runDaily(SKILL_UPDATE_CHECK);

    expect((await library.read(name)).update).toEqual({ tag: "v2", commit: newer });
  });

  it("checks the Sources after one that fails in an unforeseen way", async () => {
    const failing = await createSourceRepository();
    ownSourceUrls.push(failing.url);
    try {
      const first = `first-${randomUUID().slice(0, 8)}`;
      await failing.write(`${first}/SKILL.md`, sourceSkillMd("First.", first));
      const pinnedVersion = { commit: failing.commit() };
      await library.install({ repository: failing.url, folder: first, pinnedVersion });
      const name = await installed();
      fetcher.failingUrl = failing.url;
      await source.write("CHANGELOG.md", "more\n");
      const newer = source.commit();

      await schedule.runDaily(SKILL_UPDATE_CHECK);

      expect((await library.read(name)).update).toEqual({ commit: newer });
    } finally {
      await failing.remove();
    }
  });
});
