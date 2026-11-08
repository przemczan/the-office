import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARCHIVE_PERIOD_MAX,
  archivePeriodSchema,
  officeWideLimitSchema,
  OFFICE_WIDE_LIMIT_MAX,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ARCHIVE_PERIOD } from "../../domain/task-archive.js";
import { DEFAULT_OFFICE_WIDE_LIMIT } from "../../domain/task-start.js";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-limits-http-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
});

afterEach(async () => {
  // Every test file shares the database, whose row each Start reads: it goes back to the default.
  await sendJson(work, "PUT", "/settings/office-wide-limit", {
    officeWideLimit: DEFAULT_OFFICE_WIDE_LIMIT,
  });
  await sendJson(work, "PUT", "/settings/archive-period", {
    archivePeriod: DEFAULT_ARCHIVE_PERIOD,
  });
  await work.app.close();
});

async function readLimit(): Promise<number> {
  const response = await sendJson(work, "GET", "/settings/office-wide-limit");
  return officeWideLimitSchema.parse(await response.json()).officeWideLimit;
}

async function readPeriod(): Promise<number> {
  const response = await sendJson(work, "GET", "/settings/archive-period");
  return archivePeriodSchema.parse(await response.json()).archivePeriod;
}

describe("/api/settings/office-wide-limit", () => {
  // Raised, never lowered: a lower limit could refuse another file's Start meanwhile.
  it("keeps a new limit and announces it", async () => {
    const changed = await sendJson(work, "PUT", "/settings/office-wide-limit", {
      officeWideLimit: OFFICE_WIDE_LIMIT_MAX,
    });

    expect(changed.status).toBe(200);
    expect(await readLimit()).toBe(OFFICE_WIDE_LIMIT_MAX);
    expect(webEventsOf(work)).toEqual([{ type: "office-wide-limit.changed" }]);
  });

  it.each([0, OFFICE_WIDE_LIMIT_MAX + 1, 2.5])("refuses %s desks", async (officeWideLimit) => {
    const refused = await sendJson(work, "PUT", "/settings/office-wide-limit", {
      officeWideLimit,
    });

    expect(refused.status).toBe(400);
    expect(work.published).toEqual([]);
  });
});

describe("/api/settings/archive-period", () => {
  it("is 30 days until changed", async () => {
    expect(await readPeriod()).toBe(30);
  });

  it("keeps a new period across a restart", async () => {
    const changed = await sendJson(work, "PUT", "/settings/archive-period", { archivePeriod: 90 });
    await work.app.close();
    work = await startWorkApplication(officeData);

    expect(changed.status).toBe(200);
    expect(await readPeriod()).toBe(90);
  });

  it("announces a new period", async () => {
    await sendJson(work, "PUT", "/settings/archive-period", { archivePeriod: ARCHIVE_PERIOD_MAX });

    expect(webEventsOf(work)).toEqual([{ type: "archive-period.changed" }]);
  });

  it.each([0, ARCHIVE_PERIOD_MAX + 1, 1.5])("refuses %s days", async (archivePeriod) => {
    const refused = await sendJson(work, "PUT", "/settings/archive-period", { archivePeriod });

    expect(refused.status).toBe(400);
    expect(work.published).toEqual([]);
  });
});
