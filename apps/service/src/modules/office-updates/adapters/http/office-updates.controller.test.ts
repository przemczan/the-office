import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type INestApplication } from "@nestjs/common";
import { officeUpdateSchema, type OfficeUpdate } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EngineModule, ScriptedEngine, ScriptedEngineModule } from "../../../engine/index.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { Schedule } from "../../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../../platform/schedule/schedule.fixtures.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { BusyWork } from "../../../busy-work/index.js";
import { OfficeUpdates } from "../../application/office-updates.js";
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
async function start(
  launched = true,
  overrides = [updateSystem()],
  officeFolder = checkout.path,
): Promise<void> {
  const started = await startTestApplication({
    database: true,
    moduleOverrides: [
      { module: EngineModule, useModule: ScriptedEngineModule.register(new ScriptedEngine([])) },
    ],
    imports: [
      EventsModule,
      TelemetryModule,
      EventStreamModule,
      OfficeUpdatesModule.register({
        checkout: officeFolder,
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
    expect(before.install).toBe("checkout");
    expect(before.version).toBeUndefined();
    expect(before.check).toBeUndefined();
    expect(checked.check?.newest?.commit).toBe(newest);
    expect(checked.check?.behind.map(({ subject }) => subject)).toEqual([
      "Add Settings › Updates",
      "Add the launcher",
    ]);
    expect(checked.check?.releases).toEqual([]);
    expect(checked.refusal).toBeUndefined();
  });

  it("shows an Office release's version and commit from its stamp, with no .git", async () => {
    const release = join(folder, "release");
    await mkdir(release);
    const stamp = {
      version: "1.2.3",
      commit: "0123456789abcdef0123456789abcdef01234567",
      committedAt: "2026-11-14T10:00:00+01:00",
      subject: "feat: The Office installs from released versions",
    };
    await writeFile(join(release, "office-release.json"), JSON.stringify(stamp));
    await start(true, [updateSystem()], release);

    const shown = await officeUpdate();

    expect(shown.install).toBe("release");
    expect(shown.version).toBe("1.2.3");
    expect(shown.current).toEqual({
      commit: stamp.commit,
      shortCommit: "0123456",
      subject: stamp.subject,
      committedAt: "2026-11-14T09:00:00.000Z",
    });
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

    expect(scheduled.scheduled).toMatchObject({
      kind: "update",
      target: { kind: "commit", commit: newest },
    });
    expect(scheduled.scheduled?.busy).toEqual([
      { kind: "clone", label: "The clone of a repository" },
    ]);
    expect((await officeUpdate()).scheduled).toBeUndefined();
    await expect(readFile(join(updateFolder, "request.json"))).rejects.toThrow("ENOENT");
  });
});

describe("the Office update available, for Now", () => {
  it("is the target found, since the first check found it, and none while scheduled", async () => {
    await start();
    const updates = app.get(OfficeUpdates);
    const clock = app.get<ManualSchedule>(Schedule);
    clock.setTime(new Date("2026-11-20T08:00:00Z"));
    await updates.check();
    expect(await updates.available()).toBeUndefined();

    const [newest] = await checkout.pushNewer("Newer");
    clock.setTime(new Date("2026-11-21T08:00:00Z"));
    await updates.check();
    clock.setTime(new Date("2026-11-22T08:00:00Z"));
    await updates.check();

    expect(await updates.available()).toEqual({
      target: {
        kind: "commit",
        commit: newest,
        shortCommit: newest?.slice(0, 7),
        subject: "Newer",
        committedAt: expect.any(Date),
      },
      foundAt: new Date("2026-11-21T08:00:00Z"),
    });

    const endBusy = app.get(BusyWork).begin({ kind: "clone", label: "The clone of a repository" });
    expect((await send("POST", "/schedule")).status).toBe(204);
    expect(await updates.available()).toBeUndefined();
    expect((await send("DELETE", "/schedule")).status).toBe(204);
    endBusy();
    expect(await updates.available()).toMatchObject({ foundAt: new Date("2026-11-21T08:00:00Z") });
  });
});
