import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Injectable, type INestApplication, type OnModuleInit } from "@nestjs/common";
import {
  officeUpdateRefusalSchema,
  officeUpdateSchema,
  type OfficeUpdate,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { Schedule } from "../../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../../platform/schedule/schedule.fixtures.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { BusyWork } from "../../application/busy-work.js";
import { OFFICE_UPDATE_CHECK } from "../../application/office-updates.js";
import {
  OfficeUpdateChecked,
  OfficeUpdated,
  OfficeUpdateFailed,
} from "../../domain/office-update-events.js";
import { LOCAL_CHANGES, NO_LAUNCHER } from "../../domain/update-refusal.js";
import { OfficeUpdatesModule } from "../../office-updates.module.js";
import { updateSystem } from "../../ports/update-system.fixtures.js";
import {
  createOfficeCheckout,
  type OfficeCheckoutForTests,
} from "../git/office-checkout.fixtures.js";

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

async function refusalOf(response: Promise<Response>): Promise<readonly string[]> {
  const answered = await response;
  expect(answered.status).toBe(422);
  return officeUpdateRefusalSchema.parse(await answered.json()).reasons;
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

  it("checks daily, the first check at boot, and installs nothing", async () => {
    await start();
    const [newest] = await checkout.pushNewer("Newer");
    const found: OfficeUpdateChecked[] = [];
    app.get(EventBus).subscribe(OfficeUpdateChecked, (event) => void found.push(event));

    await (app.get(Schedule) as ManualSchedule).runDaily(OFFICE_UPDATE_CHECK);

    expect(found.map(({ available, newlyFound }) => [available?.commit, newlyFound])).toEqual([
      [newest, true],
    ]);
    expect((await officeUpdate()).check?.behind).toHaveLength(1);
    expect(await checkout.head()).not.toBe(newest);
  });

  it("refuses Update with the reason: local changes, a diverged checkout, no upstream", async () => {
    await start();
    await checkout.pushNewer("Newer");
    await checkout.changeLocally();

    expect(await refusalOf(send("POST", "/schedule"))).toEqual([LOCAL_CHANGES]);
    expect((await officeUpdate()).refusal).toBe(LOCAL_CHANGES);
  });

  it("refuses Update when the checkout diverged from its upstream", async () => {
    await start();
    await checkout.pushNewer("Upstream's");
    await checkout.commitLocally("Mine");

    expect(await refusalOf(send("POST", "/schedule"))).toEqual([
      "The Office's checkout has diverged from origin/main.",
    ]);
  });

  it("refuses Update without the launcher, and when there is nothing newer", async () => {
    await start(false);
    expect((await officeUpdate()).refusal).toBe(NO_LAUNCHER);
    await app.close();

    await start();
    expect(await refusalOf(send("POST", "/schedule"))).toEqual(["The Office is up to date."]);
    expect(await refusalOf(send("DELETE", "/schedule"))).toEqual(["No update is scheduled."]);
  });

  it("refuses Update where the system doesn't offer it, before any other reason", async () => {
    const refusal = "Updating The Office runs elsewhere.";
    await start(false, [updateSystem(refusal)]);
    await checkout.pushNewer("Newer");

    expect((await officeUpdate()).refusal).toBe(refusal);
    expect(await refusalOf(send("POST", "/schedule"))).toEqual([refusal]);
  });

  it("takes the system's refusal from the system it runs on", async () => {
    await start(true, []);

    expect((await officeUpdate()).refusal).toBe(currentOperatingSystem().officeUpdateRefusal);
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

  it("keeps the update scheduled, and lets it be cancelled, when its request can't be written", async () => {
    await start();
    await checkout.pushNewer("Newer");
    // A folder where the request goes, so writing it fails.
    await mkdir(join(updateFolder, "request.json"));

    expect((await send("POST", "/schedule")).status).toBe(204);
    expect((await officeUpdate()).scheduled).toBeDefined();
    expect((await send("DELETE", "/schedule")).status).toBe(204);
    expect((await officeUpdate()).scheduled).toBeUndefined();
  });
});

describe("What the launcher did, told at boot", () => {
  it("announces an update once, and keeps it as the last result", async () => {
    const result = {
      outcome: "updated",
      from: "a".repeat(40),
      to: "b".repeat(40),
      finishedAt: "2026-11-03T10:00:00.000Z",
    };
    await writeFile(join(updateFolder, "result.json"), JSON.stringify(result));

    await start();

    const [announced] = app.get(AnnouncedResults).events;
    expect(announced).toBeInstanceOf(OfficeUpdated);
    expect(announced).toMatchObject({ from: result.from, to: result.to });
    expect((await officeUpdate()).lastResult).toEqual(result);
    await expect(readFile(join(updateFolder, "result.json"))).rejects.toThrow("ENOENT");
    await app.close();
    await start();
    expect(app.get(AnnouncedResults).events).toEqual([]);
  });

  it("announces a failed update with the step it failed at, and serves the log", async () => {
    const result = {
      outcome: "failed",
      from: "a".repeat(40),
      to: "b".repeat(40),
      failedStep: "build",
      finishedAt: "2026-11-03T10:00:00.000Z",
    };
    await writeFile(join(updateFolder, "result.json"), JSON.stringify(result));
    await writeFile(join(updateFolder, "log.txt"), "== build: npm run build\nerror TS2322\n");

    await start();

    expect(app.get(AnnouncedResults).events).toEqual([
      expect.objectContaining({ from: result.from, failedStep: "the build" }),
    ]);
    expect((await officeUpdate()).lastResult).toEqual(result);
    expect(await (await send("GET", "/log")).text()).toContain("error TS2322");
  });
});

/** What OfficeUpdates announced as it booted, heard from before the app's bootstrap. */
@Injectable()
class AnnouncedResults implements OnModuleInit {
  readonly events: (OfficeUpdated | OfficeUpdateFailed)[] = [];

  constructor(private readonly bus: EventBus) {}

  onModuleInit(): void {
    this.bus.subscribe(OfficeUpdated, (event) => void this.events.push(event));
    this.bus.subscribe(OfficeUpdateFailed, (event) => void this.events.push(event));
  }
}
