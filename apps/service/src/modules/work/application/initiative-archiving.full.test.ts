import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DATABASE, type Database } from "../../../platform/database/database.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { PostgresInitiativeRepository } from "../adapters/postgres/postgres-initiative-repository.js";
import { initiatives } from "../adapters/postgres/work.schema.js";
import { THE_USER } from "../domain/author.js";
import type { Initiative } from "../domain/initiative.js";
import { DEFAULT_ARCHIVE_PERIOD } from "../domain/task-archive.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { WorkSettings } from "../ports/work-settings.js";
import { WorkSettingsForTests } from "../ports/work-ports.fixtures.js";
import {
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../work-application.fixtures.js";
import { IdeaService } from "./idea-service.js";
import { INITIATIVE_ARCHIVING, InitiativeArchiving } from "./initiative-archiving.js";
import { InitiativeService } from "./initiative-service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every test file shares the database, so the run weighs only the test's own Initiatives: it would
 * archive another file's ended Initiatives otherwise.
 */
class OwnInitiativeRepository extends PostgresInitiativeRepository {
  constructor(
    database: Database,
    private readonly own: ReadonlySet<string>,
  ) {
    super(database);
  }

  override async list(): Promise<readonly Initiative[]> {
    return (await super.list()).filter(({ id }) => this.own.has(id));
  }
}

let officeData: string;
let work: WorkApplication;
let own: Set<string>;
let schedule: ManualSchedule;
let now: Date;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-initiative-archiving-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  own = new Set();
  work = await startWorkApplication(officeData, [
    { provide: WorkSettings, useValue: new WorkSettingsForTests() },
    {
      provide: InitiativeRepository,
      useFactory: (database: Database) => new OwnInitiativeRepository(database, own),
      inject: [DATABASE],
    },
  ]);
  schedule = work.app.get(Schedule) as ManualSchedule;
  now = new Date();
  schedule.setTime(now);
  work.app.get(InitiativeArchiving).start();
});

afterEach(async () => {
  await work.app.close();
});

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** A dropped Initiative, ended `endedDaysAgo` days before `now`, or with no end kept. */
async function ended(endedDaysAgo: number | undefined): Promise<Initiative> {
  const idea = await work.app
    .get(IdeaService)
    .capture({ title: "Offline sync", notes: "", projectId: undefined }, THE_USER);
  const initiative = await work.app.get(InitiativeService).shape(idea.id, THE_USER);
  own.add(initiative.id);
  await work.app.get(InitiativeService).drop(initiative.id);
  await theDatabase()
    .update(initiatives)
    .set({ endedAt: endedDaysAgo === undefined ? null : daysAgo(endedDaysAgo) })
    .where(eq(initiatives.id, initiative.id));
  return initiative;
}

function theDatabase(): Database {
  return work.app.get<Database>(DATABASE);
}

async function isArchived({ id }: Initiative): Promise<boolean> {
  return (await work.app.get(InitiativeService).read(id)).archivedAt !== undefined;
}

async function runAt(at: Date): Promise<void> {
  schedule.setTime(at);
  await schedule.runDaily(INITIATIVE_ARCHIVING);
}

describe("The daily archiving of ended Initiatives", () => {
  it("archives one ended longer ago than the period, and one nothing dates, each announced", async () => {
    const old = await ended(DEFAULT_ARCHIVE_PERIOD + 1);
    const undated = await ended(undefined);
    const recent = await ended(DEFAULT_ARCHIVE_PERIOD - 1);
    work.published.length = 0;

    await runAt(now);

    expect(await isArchived(old)).toBe(true);
    expect(await isArchived(undated)).toBe(true);
    expect(await isArchived(recent)).toBe(false);
    expect(webEventsOf(work)).toEqual(
      expect.arrayContaining([
        { type: "initiative.archived", initiativeId: old.id },
        { type: "initiative.archived", initiativeId: undated.id },
      ]),
    );
    expect(work.published).toHaveLength(2);
    expect(await work.app.get(InitiativeService).read(old.id)).toMatchObject({
      state: "dropped",
      archivedAt: now,
    });
  });

  it("never archives one being shaped or active", async () => {
    const idea = await work.app
      .get(IdeaService)
      .capture({ title: "Usage exports", notes: "", projectId: undefined }, THE_USER);
    const shaping = await work.app.get(InitiativeService).shape(idea.id, THE_USER);
    own.add(shaping.id);
    await theDatabase()
      .update(initiatives)
      .set({ createdAt: daysAgo(10 * DEFAULT_ARCHIVE_PERIOD) })
      .where(eq(initiatives.id, shaping.id));

    await runAt(now);

    expect(await isArchived(shaping)).toBe(false);
  });

  it("gives a restored one a full period from its Restore, however long ago it ended", async () => {
    const initiative = await ended(2 * DEFAULT_ARCHIVE_PERIOD);
    await runAt(now);
    expect(await isArchived(initiative)).toBe(true);
    await work.app.get(InitiativeService).restore(initiative.id);
    const { restoredAt } = await work.app.get(InitiativeService).read(initiative.id);
    if (!restoredAt) throw new Error("The Restore kept no moment.");
    const daysAfterRestore = (days: number) => new Date(restoredAt.getTime() + days * DAY_MS);

    await runAt(daysAfterRestore(DEFAULT_ARCHIVE_PERIOD - 1));
    expect(await isArchived(initiative)).toBe(false);

    await runAt(daysAfterRestore(DEFAULT_ARCHIVE_PERIOD + 1));
    expect(await isArchived(initiative)).toBe(true);
  });
});
