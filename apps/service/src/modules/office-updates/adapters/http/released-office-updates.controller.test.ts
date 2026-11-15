import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type INestApplication } from "@nestjs/common";
import { officeUpdateSchema, type OfficeUpdate } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { OfficeUpdates } from "../../application/office-updates.js";
import type { InstallKind } from "../../domain/install-kind.js";
import type { OfficeContainerRead } from "../../domain/office-container.js";
import { OfficeUpdateCancelled, OfficeUpdateFailed } from "../../domain/office-update-events.js";
import type { PublishedRelease } from "../../domain/published-release.js";
import { NOT_INSTALLED } from "../../domain/update-refusal.js";
import { OfficeUpdatesModule } from "../../office-updates.module.js";
import {
  OfficeContainer,
  type StartedUpdater,
  type UpdaterRequest,
} from "../../ports/office-container.js";
import { OfficeReleases } from "../../ports/office-releases.js";
import { TEST_ARCHITECTURE, updateSystem } from "../../ports/update-system.fixtures.js";
import { AnnouncedResults, refusalOf } from "./office-updates.controller.fixtures.js";

const REPOSITORY = "owner/the-office";

function published(version: string, notes = `What ${version} brings.`): PublishedRelease {
  const tarball = `the-office-${version}-linux-${TEST_ARCHITECTURE}.tar.gz`;
  const download = `https://github.com/${REPOSITORY}/releases/download/v${version}`;
  return {
    version,
    name: `The Office ${version}`,
    publishedAt: new Date("2026-11-14T10:00:00.000Z"),
    notes,
    url: `https://github.com/${REPOSITORY}/releases/tag/v${version}`,
    assets: [
      { name: tarball, url: `${download}/${tarball}` },
      { name: `${tarball}.sha256`, url: `${download}/${tarball}.sha256` },
    ],
  };
}

/** GitHub Releases as the tests give them: these, or a read that fails. */
class FakeReleases extends OfficeReleases {
  answer: PublishedRelease[] | Error = [];
  readonly asked: [string, string][] = [];

  newerThan(repository: string, version: string): Promise<PublishedRelease[]> {
    this.asked.push([repository, version]);
    return this.answer instanceof Error
      ? Promise.reject(this.answer)
      : Promise.resolve(this.answer);
  }
}

/** A container Docker Compose started, and an Office updater the test ends. */
class FakeContainer extends OfficeContainer {
  containerRead: OfficeContainerRead = {
    reachable: true,
    container: {
      id: "c0ffee",
      image: "ghcr.io/owner/the-office:1.3.0",
      imageId: "sha256:1234",
      compose: {
        project: "the-office",
        service: "office",
        workingDirectory: "/srv/the-office",
        configFiles: ["/srv/the-office/docker-compose.yml"],
        environmentFiles: [],
      },
      mounts: [],
    },
  };
  readonly started: UpdaterRequest[] = [];
  endUpdater: () => void = () => undefined;

  read(): Promise<OfficeContainerRead> {
    return Promise.resolve(this.containerRead);
  }

  startUpdater(request: UpdaterRequest): Promise<StartedUpdater> {
    this.started.push(request);
    const ended = new Promise<void>((resolve) => (this.endUpdater = resolve));
    return Promise.resolve({ ended });
  }
}

let folder: string;
let release: string;
let updateFolder: string;
let releases: FakeReleases;
let container: FakeContainer;
let app: INestApplication;
let url: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-updates-releases-"));
  release = join(folder, "releases", "1.3.0");
  updateFolder = join(folder, "update");
  await mkdir(release, { recursive: true });
  await mkdir(updateFolder);
  await writeFile(
    join(release, "office-release.json"),
    JSON.stringify({
      version: "1.3.0",
      commit: "0123456789abcdef0123456789abcdef01234567",
      committedAt: "2026-11-01T10:00:00Z",
      subject: "feat: The Office 1.3.0",
      repository: REPOSITORY,
    }),
  );
  releases = new FakeReleases();
  container = new FakeContainer();
});

afterEach(async () => {
  await app.close();
  await rm(folder, { recursive: true, force: true });
});

async function start(install: InstallKind | undefined, launched = true): Promise<void> {
  const started = await startTestApplication({
    imports: [
      EventsModule,
      EventStreamModule,
      OfficeUpdatesModule.register({
        checkout: release,
        updateFolder: install !== "container" && launched ? updateFolder : undefined,
        install,
        officeDataDirectory: folder,
      }),
    ],
    providers: [AnnouncedResults],
    overrides: [
      updateSystem(),
      { provide: OfficeReleases, useValue: releases },
      { provide: OfficeContainer, useValue: container },
    ],
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

async function requestWritten(): Promise<unknown> {
  return JSON.parse(await readFile(join(updateFolder, "request.json"), "utf8"));
}

describe("A release install's Settings › Updates", () => {
  it("shows the install and its version, and Check for updates lists the newer releases with their notes", async () => {
    releases.answer = [published("1.5.0"), published("1.4.0")];
    await start("release");

    const checked = await officeUpdate("/check", "POST");

    expect(releases.asked).toEqual([[REPOSITORY, "1.3.0"]]);
    expect(checked.install).toBe("release");
    expect(checked.version).toBe("1.3.0");
    expect(checked.check?.releases).toEqual([
      {
        version: "1.5.0",
        name: "The Office 1.5.0",
        publishedAt: "2026-11-14T10:00:00.000Z",
        notes: "What 1.5.0 brings.",
        url: `https://github.com/${REPOSITORY}/releases/tag/v1.5.0`,
      },
      expect.objectContaining({ version: "1.4.0" }),
    ]);
    expect(checked.check?.behind).toEqual([]);
    expect(checked.refusal).toBeUndefined();
  });

  it("shows a failed read of GitHub Releases as the check's problem, and Update installs nothing", async () => {
    releases.answer = new Error("GitHub answered 404 for owner/the-office's releases.");
    await start("release");

    const checked = await officeUpdate("/check", "POST");

    expect(checked.check?.problem).toBe(
      "GitHub Releases couldn't be read: GitHub answered 404 for owner/the-office's releases.",
    );
    expect(checked.check?.releases).toEqual([]);
    expect(await refusalOf(send("POST", "/schedule"))).toEqual([checked.check?.problem]);
    await expect(requestWritten()).rejects.toThrow("ENOENT");
  });

  it("schedules the newest release: asks the launcher for its tarball and stops", async () => {
    releases.answer = [published("1.4.0")];
    await start("release");
    const ready = vi.fn<() => void>();
    app.get(OfficeUpdates).onReadyToUpdate(ready);

    expect((await send("POST", "/schedule")).status).toBe(204);

    const download = `https://github.com/${REPOSITORY}/releases/download/v1.4.0`;
    expect(await requestWritten()).toEqual({
      kind: "release",
      version: "1.4.0",
      from: "1.3.0",
      tarballUrl: `${download}/the-office-1.4.0-linux-x64.tar.gz`,
      checksumUrl: `${download}/the-office-1.4.0-linux-x64.tar.gz.sha256`,
    });
    expect(ready).toHaveBeenCalledOnce();
    expect((await officeUpdate()).scheduled?.target).toEqual({
      kind: "release",
      version: "1.4.0",
      name: "The Office 1.4.0",
      publishedAt: "2026-11-14T10:00:00.000Z",
      url: `https://github.com/${REPOSITORY}/releases/tag/v1.4.0`,
    });
  });

  it("refuses Update for a release copy its launcher doesn't run from a releases folder", async () => {
    releases.answer = [published("1.4.0")];
    await start(undefined);

    expect((await officeUpdate()).install).toBe("release");
    expect(await refusalOf(send("POST", "/schedule"))).toEqual([NOT_INSTALLED]);
  });

  it("refuses Update when the newest release has no tarball for this CPU", async () => {
    releases.answer = [{ ...published("1.4.0"), assets: [] }];
    await start("release");

    const [reason] = await refusalOf(send("POST", "/schedule"));

    expect(reason).toMatch(/^Version 1\.4\.0 has no tarball for Linux on x64/);
  });
});

describe("A container's Settings › Updates", () => {
  it("hands the update to the Office updater and stays up", async () => {
    releases.answer = [published("1.4.0")];
    await start("container");
    const ready = vi.fn<() => void>();
    app.get(OfficeUpdates).onReadyToUpdate(ready);

    expect((await send("POST", "/schedule")).status).toBe(204);

    expect(await requestWritten()).toEqual({
      kind: "container",
      version: "1.4.0",
      from: "1.3.0",
      image: "ghcr.io/owner/the-office",
    });
    expect(container.started).toEqual([{ updateFolder, officeDataDirectory: folder }]);
    expect(ready).not.toHaveBeenCalled();
    expect((await officeUpdate()).install).toBe("container");
    expect(await refusalOf(send("DELETE", "/schedule"))).toEqual([
      "The update is under way: The Office is stopping for it.",
    ]);
  });

  it("announces the failure and releases the hold when the updater ends before replacing it", async () => {
    releases.answer = [published("1.4.0")];
    await start("container");
    const cancelled = vi.fn<() => void>();
    app.get(EventBus).subscribe(OfficeUpdateCancelled, cancelled);
    expect((await send("POST", "/schedule")).status).toBe(204);
    const failed = {
      outcome: "failed",
      from: "1.3.0",
      to: "1.4.0",
      failedStep: "download",
      finishedAt: "2026-11-15T10:00:00.000Z",
    };
    await writeFile(join(updateFolder, "result.json"), JSON.stringify(failed));

    container.endUpdater();

    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
    const [announced] = app.get(AnnouncedResults).events;
    expect(announced).toBeInstanceOf(OfficeUpdateFailed);
    expect(announced).toMatchObject({ to: "1.4.0", failedStep: "downloading the new version" });
    const shown = await officeUpdate();
    expect(shown.scheduled).toBeUndefined();
    expect(shown.lastResult).toEqual(failed);
  });

  it("refuses Update without Docker's socket", async () => {
    releases.answer = [published("1.4.0")];
    container.containerRead = { reachable: false, problem: "EACCES: /var/run/docker.sock" };
    await start("container");

    const [reason] = await refusalOf(send("POST", "/schedule"));

    expect(reason).toMatch(/can't reach Docker at \/var\/run\/docker\.sock/);
  });
});
