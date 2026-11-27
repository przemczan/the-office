import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type INestApplication } from "@nestjs/common";
import { officeUpdateSchema, type OfficeUpdate } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EngineModule, ScriptedEngine, ScriptedEngineModule } from "../../../engine/index.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { BusyWork, ScheduledExitHold } from "../../../busy-work/index.js";
import { NO_RESTART_SCHEDULED, RESTARTING } from "../../application/office-restarts.js";
import { RESTART_SCHEDULED } from "../../application/office-updates.js";
import { ScheduledExits } from "../../application/scheduled-exits.js";
import type { InstallKind } from "../../domain/install-kind.js";
import type { OfficeContainerRead } from "../../domain/office-container.js";
import { ScheduledExitCancelled } from "../../domain/office-update-events.js";
import {
  NO_LAUNCHER_TO_RESTART,
  NOT_INSTALLED_TO_RESTART,
  UPDATE_SCHEDULED_ALREADY,
  dockerUnreachable,
  noRestartPolicy,
} from "../../domain/restart-refusal.js";
import { OfficeUpdatesModule } from "../../office-updates.module.js";
import {
  OfficeContainer,
  type StartedUpdater,
  type UpdaterRequest,
} from "../../ports/office-container.js";
import { updateSystem } from "../../ports/update-system.fixtures.js";
import {
  createOfficeCheckout,
  type OfficeCheckoutForTests,
} from "../git/office-checkout.fixtures.js";
import { refusalOf } from "./office-updates.controller.fixtures.js";

/** The service's container as Docker would read it now; the tests change its restart policy. */
class FakeContainer extends OfficeContainer {
  containerRead: OfficeContainerRead = containerWith("unless-stopped");
  reads = 0;

  read(): Promise<OfficeContainerRead> {
    this.reads += 1;
    return Promise.resolve(this.containerRead);
  }

  startUpdater(_request: UpdaterRequest): Promise<StartedUpdater> {
    return Promise.reject(new Error("A restart starts no Office updater."));
  }
}

function containerWith(restartPolicy: string): OfficeContainerRead {
  return {
    reachable: true,
    container: {
      id: "c0ffee",
      image: "ghcr.io/owner/the-office:1.3.0",
      imageId: "sha256:1234",
      compose: undefined,
      mounts: [],
      restartPolicy,
    },
  };
}

let folder: string;
let checkout: OfficeCheckoutForTests;
let release: string;
let updateFolder: string;
let container: FakeContainer;
let app: INestApplication;
let url: string;
let ready: () => void;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-restart-http-"));
  checkout = await createOfficeCheckout(join(folder, "office"));
  release = join(folder, "release");
  updateFolder = join(folder, "update");
  await mkdir(release);
  await mkdir(updateFolder);
  await writeFile(
    join(release, "office-release.json"),
    JSON.stringify({
      version: "1.3.0",
      commit: "0123456789abcdef0123456789abcdef01234567",
      committedAt: "2026-11-01T10:00:00Z",
      subject: "feat: The Office 1.3.0",
      repository: "owner/the-office",
    }),
  );
  container = new FakeContainer();
});

afterEach(async () => {
  await app.close();
  await rm(folder, { recursive: true, force: true });
});

interface Started {
  readonly install?: InstallKind;
  readonly launched?: boolean;
  readonly officeFolder?: string;
}

async function start({
  install,
  launched = true,
  officeFolder = checkout.path,
}: Started = {}): Promise<void> {
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
        updateFolder: install !== "container" && launched ? updateFolder : undefined,
        install,
        officeDataDirectory: folder,
      }),
    ],
    overrides: [updateSystem(), { provide: OfficeContainer, useValue: container }],
  });
  app = started.app;
  url = started.url;
  ready = vi.fn<() => void>();
  app.get(ScheduledExits).onReadyToExit(ready);
}

function send(method: string, path: string): Promise<Response> {
  return fetch(`${url}/api${path}`, { method });
}

async function officeUpdate(): Promise<OfficeUpdate> {
  return officeUpdateSchema.parse(await (await send("GET", "/office-update")).json());
}

function busy(): () => void {
  return app.get(BusyWork).begin({ kind: "clone", label: "The clone of a repository" });
}

async function requestWritten(): Promise<unknown> {
  return JSON.parse(await readFile(join(updateFolder, "request.json"), "utf8"));
}

describe("Restart under the launcher", () => {
  it("is offered, holds work while it waits for what is busy, and cancels", async () => {
    await start();
    const cancelled = vi.fn<() => void>();
    app.get(EventBus).subscribe(ScheduledExitCancelled, cancelled);
    const endBusy = busy();

    expect((await officeUpdate()).restart).toEqual({});
    expect((await send("POST", "/office-restart/schedule")).status).toBe(204);
    const scheduled = await officeUpdate();
    const wait = app.get(ScheduledExitHold).waitWords();
    expect((await send("DELETE", "/office-restart/schedule")).status).toBe(204);
    endBusy();

    expect(scheduled.scheduled).toEqual({
      kind: "restart",
      scheduledAt: expect.any(String),
      busy: [{ kind: "clone", label: "The clone of a repository" }],
    });
    expect(wait).toEqual({ reason: "A restart is scheduled.", short: "Office restart scheduled" });
    expect(cancelled).toHaveBeenCalledOnce();
    expect((await officeUpdate()).scheduled).toBeUndefined();
    expect(ready).not.toHaveBeenCalled();
    await expect(requestWritten()).rejects.toThrow("ENOENT");
  });

  it("asks the launcher for a restart and exits once nothing is busy; Cancel is refused then", async () => {
    await start();
    const endBusy = busy();
    expect((await send("POST", "/office-restart/schedule")).status).toBe(204);

    endBusy();

    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    expect(await requestWritten()).toEqual({ kind: "restart" });
    expect(await refusalOf(send("DELETE", "/office-restart/schedule"))).toEqual([RESTARTING]);
  });

  it("is refused while an update is scheduled, and an update while a restart is", async () => {
    await start();
    await checkout.pushNewer("Newer");
    const endBusy = busy();

    expect((await send("POST", "/office-update/schedule")).status).toBe(204);
    const whileUpdating = await officeUpdate();
    expect(await refusalOf(send("POST", "/office-restart/schedule"))).toEqual([
      UPDATE_SCHEDULED_ALREADY,
    ]);
    expect(await refusalOf(send("DELETE", "/office-restart/schedule"))).toEqual([
      NO_RESTART_SCHEDULED,
    ]);
    expect((await send("DELETE", "/office-update/schedule")).status).toBe(204);
    expect((await send("POST", "/office-restart/schedule")).status).toBe(204);
    expect(await refusalOf(send("POST", "/office-update/schedule"))).toEqual([RESTART_SCHEDULED]);
    endBusy();

    expect(whileUpdating.scheduled?.kind).toBe("update");
    expect(whileUpdating.restart.refusal).toBe(UPDATE_SCHEDULED_ALREADY);
  });

  it("is refused without the launcher, which would start The Office again", async () => {
    await start({ launched: false });

    expect((await officeUpdate()).restart.refusal).toBe(NO_LAUNCHER_TO_RESTART);
    expect(await refusalOf(send("POST", "/office-restart/schedule"))).toEqual([
      NO_LAUNCHER_TO_RESTART,
    ]);
  });

  it("is refused for a release copy its launcher doesn't run from a releases folder", async () => {
    await start({ officeFolder: release });

    expect(await refusalOf(send("POST", "/office-restart/schedule"))).toEqual([
      NOT_INSTALLED_TO_RESTART,
    ]);
  });
});

describe("Restart in a container", () => {
  it("exits once nothing is busy, leaving no request, as Docker's restart policy starts it again", async () => {
    await start({ install: "container", officeFolder: release });

    expect((await send("POST", "/office-restart/schedule")).status).toBe(204);

    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    await expect(readFile(join(folder, "update", "request.json"))).rejects.toThrow("ENOENT");
  });

  it("is refused when Docker wouldn't start it again, or can't be reached", async () => {
    container.containerRead = containerWith("no");
    await start({ install: "container", officeFolder: release });

    expect(await refusalOf(send("POST", "/office-restart/schedule"))).toEqual([
      noRestartPolicy("no"),
    ]);
    container.containerRead = { reachable: false, problem: "EACCES: /var/run/docker.sock" };
    expect((await officeUpdate()).restart.refusal).toBe(
      dockerUnreachable("EACCES: /var/run/docker.sock"),
    );
  });

  it("stays scheduled without exiting when the restart policy changed while it waited", async () => {
    await start({ install: "container", officeFolder: release });
    const endBusy = busy();
    expect((await send("POST", "/office-restart/schedule")).status).toBe(204);
    container.containerRead = containerWith("no");
    const readsBefore = container.reads;

    endBusy();

    await vi.waitFor(() => {
      expect(container.reads).toBeGreaterThan(readsBefore);
      expect(app.get(ScheduledExits).underWay).toBe(false);
    });
    expect(ready).not.toHaveBeenCalled();
    expect((await officeUpdate()).scheduled?.kind).toBe("restart");
    container.containerRead = containerWith("always");
    busy()();
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
  });
});
