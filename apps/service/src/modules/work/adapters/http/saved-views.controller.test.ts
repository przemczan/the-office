import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  savedViewListSchema,
  savedViewSchema,
  workRefusalSchema,
  type SavedView,
} from "@the-office/contracts";
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
  if (response.status === 201) saved.push(savedViewSchema.parse(await response.clone().json()).id);
  return response;
}

async function listViews(): Promise<SavedView[]> {
  const response = await sendJson(work, "GET", "/saved-views");
  return savedViewListSchema.parse(await response.json());
}

describe("/api/saved-views", () => {
  it("saves the board's filters under a name, keeping only those set, and announces it", async () => {
    const name = aName("Firmware bugs");
    const initiative = randomUUID();

    const response = await saveView({
      name: `  ${name} `,
      filters: { query: " flash ", priority: "high", initiative },
    });

    expect(response.status).toBe(201);
    const view = savedViewSchema.parse(await response.json());
    expect(view).toMatchObject({
      name,
      filters: { query: "flash", priority: "high", initiative },
    });
    expect(await listViews()).toContainEqual(view);
    expect(webEventsOf(work)).toEqual([{ type: "saved-view.saved", savedViewId: view.id }]);
  });

  it("never keeps the Project filter", async () => {
    const response = await saveView({
      name: aName("Blocked"),
      filters: { blocked: true, projectIds: ["firmware"] },
      projectIds: ["firmware"],
    });

    expect(response.status).toBe(201);
    const view = savedViewSchema.parse(await response.json());
    expect(view.filters).toEqual({ blocked: true });
    expect((await listViews()).find(({ id }) => id === view.id)).toEqual(view);
  });

  it("never keeps Tags", async () => {
    const response = await saveView({
      name: aName("Tagged"),
      filters: { blocked: true, tags: ["bug"] },
    });

    expect(response.status).toBe(201);
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

  it("refuses a view with no name, no filter or a name taken, with every reason", async () => {
    const name = aName("Taken");
    await saveView({ name, filters: { blocked: true } });
    work.published.length = 0;

    const unnamed = await saveView({ name: " ", filters: { query: "  " } });
    const taken = await saveView({ name: name.toUpperCase(), filters: { priority: "low" } });

    expect(unnamed.status).toBe(422);
    expect(workRefusalSchema.parse(await unnamed.json()).reasons).toEqual([
      "Name the view.",
      "Choose a filter for the view to save.",
    ]);
    expect(taken.status).toBe(422);
    expect(workRefusalSchema.parse(await taken.json()).reasons).toEqual([
      `There is already a view named "${name.toUpperCase()}".`,
    ]);
    expect(work.published).toEqual([]);
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

    expect(removed.status).toBe(204);
    expect((await listViews()).map(({ id }) => id)).not.toContain(view.id);
    expect(webEventsOf(work)).toEqual([{ type: "saved-view.removed", savedViewId: view.id }]);
  });

  it("answers 404 for a view that isn't there", async () => {
    const response = await sendJson(work, "DELETE", `/saved-views/${randomUUID()}`);

    expect(response.status).toBe(404);
  });
});
