import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savedViewListSchema, savedViewSchema, type SavedView } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";

let officeData: string;
let work: WorkApplication;
const saved: string[] = [];

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "saved-views-http-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
});

afterEach(async () => {
  // Every test file shares the database: the views saved here go.
  for (const id of saved.splice(0)) await sendJson(work, "DELETE", `/saved-views/${id}`);
  await work.app.close();
});

/** A name no other test's view has, as they share the database. */
function aName(words: string): string {
  return `${words} ${randomUUID().slice(0, 8)}`;
}

async function saveView(body: unknown): Promise<Response> {
  const response = await sendJson(work, "POST", "/saved-views", body);
  if (response.status === 200) saved.push(savedViewSchema.parse(await response.clone().json()).id);
  return response;
}

async function listViews(): Promise<SavedView[]> {
  const response = await sendJson(work, "GET", "/saved-views");
  return savedViewListSchema.parse(await response.json());
}

describe("/api/saved-views", () => {
  it("never keeps the Project filter", async () => {
    const response = await saveView({
      name: aName("Blocked"),
      filters: { blocked: true, projectIds: ["firmware"] },
      projectIds: ["firmware"],
    });

    expect(response.status).toBe(200);
    const view = savedViewSchema.parse(await response.json());
    expect(view.filters).toEqual({ blocked: true });
    expect((await listViews()).find(({ id }) => id === view.id)).toEqual(view);
  });

  it("never keeps Tags", async () => {
    const response = await saveView({
      name: aName("Tagged"),
      filters: { blocked: true, tags: ["bug"] },
    });

    expect(response.status).toBe(200);
    const view = savedViewSchema.parse(await response.json());
    expect((await listViews()).find(({ id }) => id === view.id)?.filters).toEqual({
      blocked: true,
    });
  });

  it("lists the views in the order saved", async () => {
    const first = savedViewSchema.parse(
      await (await saveView({ name: aName("First"), filters: { priority: "low" } })).json(),
    );
    const second = savedViewSchema.parse(
      await (await saveView({ name: aName("Second"), filters: { priority: "high" } })).json(),
    );

    const ids = (await listViews()).map(({ id }) => id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
  });

  it("refuses filters that aren't the board's", async () => {
    const response = await saveView({ name: aName("Odd"), filters: { priority: "urgent" } });

    expect(response.status).toBe(400);
    expect(work.published).toEqual([]);
  });

  it("removes a view and announces it", async () => {
    const view = savedViewSchema.parse(
      await (await saveView({ name: aName("Gone"), filters: { blocked: true } })).json(),
    );
    work.published.length = 0;

    const removed = await sendJson(work, "DELETE", `/saved-views/${view.id}`);

    expect(removed.status).toBe(200);
    expect((await listViews()).map(({ id }) => id)).not.toContain(view.id);
    expect(webEventsOf(work)).toEqual([{ type: "saved-view.removed", savedViewId: view.id }]);
  });

  it("answers 404 for a view that isn't there", async () => {
    const response = await sendJson(work, "DELETE", `/saved-views/${randomUUID()}`);

    expect(response.status).toBe(404);
  });
});
