import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type INestApplication } from "@nestjs/common";
import { officeUpdateSchema, type OfficeUpdate } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { BusyWork } from "../../application/busy-work.js";
import { LOCAL_CHANGES } from "../../domain/update-refusal.js";
import { OfficeUpdatesModule } from "../../office-updates.module.js";
import { updateSystem } from "../../ports/update-system.fixtures.js";
import {
  createOfficeCheckout,
  type OfficeCheckoutForTests,
} from "../git/office-checkout.fixtures.js";
import { refusalOf, AnnouncedResults } from "./office-updates.controller.fixtures.js";

let folder: string;
let checkout: OfficeCheckoutForTests;
let updateFolder: string;
let app: INestApplication;
let url: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-updates-http-"));
  checkout = await createOfficeCheckout(join(folder, "office"));
  updateFolder = join(folder, "update");
  await mkdir(updateFolder);
});

afterEach(async () => {
  await app.close();
  await rm(folder, { recursive: true, force: true });
});

/** On a system that updates The Office, whichever the tests run on, unless told `overrides`. */
async function start(launched = true, overrides = [updateSystem()]): Promise<void> {
  const started = await startTestApplication({
    imports: [
      EventsModule,
      EventStreamModule,
      OfficeUpdatesModule.register({
        checkout: checkout.path,
        updateFolder: launched ? updateFolder : undefined,
      }),
    ],
    providers: [AnnouncedResults],
    overrides,
  });
  app = started.app;
  url = started.url;
}

function send(method: string, path: string): Promise<Response> {
  return fetch(`${url}/api/office-update${path}`, { method });
}

async function officeUpdate(path = "", method = "GET"): Promise<OfficeUpdate> {
  return officeUpdateSchema.parse(await (await send(method, path)).json());
}

describe("Settings › Updates", () => {
  it("shows the current version, and Check for updates lists the commits it is behind", async () => {
    await start();
    const [, newest] = await checkout.pushNewer("Add the launcher", "Add Settings › Updates");

    const before = await officeUpdate();
    const checked = await officeUpdate("/check", "POST");

    expect(before.current).toMatchObject({
      commit: await checkout.head(),
      subject: "The first version",
    });
    expect(before.current.shortCommit).toHaveLength(7);
    expect(before.check).toBeUndefined();
    expect(checked.check?.newest?.commit).toBe(newest);
    expect(checked.check?.behind.map(({ subject }) => subject)).toEqual([
      "Add Settings › Updates",
      "Add the launcher",
    ]);
    expect(checked.refusal).toBeUndefined();
  });

  it("refuses Update with the reason: local changes, a diverged checkout, no upstream", async () => {
    await start();
    await checkout.pushNewer("Newer");
    await checkout.changeLocally();

    expect(await refusalOf(send("POST", "/schedule"))).toEqual([LOCAL_CHANGES]);
    expect((await officeUpdate()).refusal).toBe(LOCAL_CHANGES);
  });

  it("schedules an update, shows what it waits for, and cancels it", async () => {
    await start();
    const [newest] = await checkout.pushNewer("Newer");
    const endBusy = app.get(BusyWork).begin({ kind: "clone", label: "The clone of a repository" });

    expect((await send("POST", "/schedule")).status).toBe(204);
    const scheduled = await officeUpdate();
    expect((await send("DELETE", "/schedule")).status).toBe(204);
    endBusy();

    expect(scheduled.scheduled?.target.commit).toBe(newest);
    expect(scheduled.scheduled?.busy).toEqual([
      { kind: "clone", label: "The clone of a repository" },
    ]);
    expect((await officeUpdate()).scheduled).toBeUndefined();
    await expect(readFile(join(updateFolder, "request.json"))).rejects.toThrow("ENOENT");
  });
});
