// An Office update of a direct install (docs/running-the-office.md): the launcher downloads the
// released version's tarball, verifies it, unpacks it beside the other releases, switches `current`
// to it and starts it, and goes back to the version it came from when the new one doesn't come up.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { HEALTH_TIMEOUT_MS, waitUntilHealthy, type HealthWait } from "./service-health.ts";
import { stopService, type RunningService } from "./service-process.ts";
import {
  DOWNLOADS_FOLDER,
  failure,
  UpdateLog,
  writeResult,
  type ReleaseRequest,
  type UpdateResult,
  type UpdateStep,
} from "./update-folder.ts";

/** The folder of a direct install holding each release, `<installRoot>/releases/<version>`. */
export const RELEASES_FOLDER = "releases";
/** The link to the release the service starts from, `<installRoot>/current`. */
export const CURRENT_LINK = "current";
/** The stamp at a release's root, as tools/release writes it. */
export const RELEASE_STAMP_FILE = "office-release.json";

/** A direct install's layout, as the launcher found it. */
export interface ReleaseInstall {
  /** The folder holding `releases/` and `current`, such as `/opt/the-office`. */
  readonly installRoot: string;
  /** The release the running launcher was loaded from, which every prune keeps. */
  readonly launcherRelease: string;
}

export interface ReleaseUpdateOptions extends ReleaseInstall {
  readonly updateFolder: string;
  /** Starts the service from `current`, as it points now. */
  readonly startService: () => RunningService;
  /** Where the new version answers /api/health; it throws when that can't be told. */
  readonly healthUrl: () => string;
  readonly health?: HealthWait;
  /** How a URL is downloaded; fetch, unless a test serves the release itself. */
  readonly download?: (url: string) => Promise<Response>;
}

export interface ReleaseUpdateOutcome {
  readonly result: UpdateResult;
  /** The new version, started and healthy; absent when the previous version is to start again. */
  readonly service?: RunningService;
}

type UpdateEnding =
  | { readonly outcome: "updated" }
  | { readonly outcome: "failed"; readonly failedStep: UpdateStep; readonly rollbackFailed?: true };

class StepFailed extends Error {
  readonly step: UpdateStep;

  constructor(step: UpdateStep, cause: unknown) {
    super(failure(cause));
    this.step = step;
  }
}

/**
 * Runs the release update `request` asks for. `result.json` says how it went, and `log.txt` holds
 * every step: written `updated` before the new version starts, so it reads it at boot, and
 * `failed` when it went back.
 */
export async function runReleaseUpdate(
  options: ReleaseUpdateOptions,
  request: ReleaseRequest,
): Promise<ReleaseUpdateOutcome> {
  const log = new UpdateLog(options.updateFolder);
  const finished = (ending: UpdateEnding): UpdateResult => {
    const ended: UpdateResult = {
      ...ending,
      from: request.from,
      to: request.version,
      finishedAt: new Date().toISOString(),
    };
    writeResult(options.updateFolder, ended);
    return ended;
  };
  try {
    let healthUrl: string;
    try {
      // Before anything changes: a new version whose health can't be checked is never switched to.
      healthUrl = await attempt(log, "start", "where it answers /api/health", options.healthUrl);
      await install(options, request, log);
    } catch (error) {
      if (!(error instanceof StepFailed)) throw error;
      log.write(`== ${error.step} failed: ${error.message}`);
      return { result: finished({ outcome: "failed", failedStep: error.step }) };
    } finally {
      emptyDownloads(options.updateFolder);
    }
    const result = finished({ outcome: "updated" });
    const service = await startNewVersion(options, healthUrl, request, log);
    if (service) {
      prune(options, request, log);
      return { result, service };
    }
    const rolledBack = switchBack(options, request, log);
    return {
      result: finished({
        outcome: "failed",
        failedStep: "start",
        ...(rolledBack ? {} : { rollbackFailed: true as const }),
      }),
    };
  } finally {
    log.close();
  }
}

/** Download, verify, unpack and switch: nothing changes until the switch, the last of them. */
async function install(
  { installRoot, updateFolder, download = fetch }: ReleaseUpdateOptions,
  { version, tarballUrl, checksumUrl }: ReleaseRequest,
  log: UpdateLog,
): Promise<void> {
  const downloads = join(updateFolder, DOWNLOADS_FOLDER);
  const tarball = join(downloads, fileNameOf(tarballUrl));
  const checksum = join(downloads, fileNameOf(checksumUrl));
  await attempt(log, "download", tarballUrl, async () => {
    mkdirSync(downloads, { recursive: true });
    await downloadTo(download, tarballUrl, tarball);
    await downloadTo(download, checksumUrl, checksum);
  });
  await attempt(log, "verify", basename(tarball), () => verifyChecksum(tarball, checksum));
  const releases = join(installRoot, RELEASES_FOLDER);
  const unpacking = join(releases, `.unpack-${version}`);
  const release = join(releases, version);
  await attempt(log, "unpack", `${basename(tarball)} into ${unpacking}`, async () => {
    if (isCurrent(installRoot, release)) throw new Error(`${release} is the release running now.`);
    rmSync(unpacking, { recursive: true, force: true });
    mkdirSync(unpacking, { recursive: true });
    await untar(tarball, unpacking, log);
  });
  await attempt(log, "verify", `the unpacked release is The Office ${version}`, () =>
    verifyUnpacked(unpacking, version),
  );
  await attempt(log, "unpack", `into ${release}`, () => {
    rmSync(release, { recursive: true, force: true });
    renameSync(join(unpacking, `the-office-${version}`), release);
    rmSync(unpacking, { recursive: true, force: true });
  });
  await attempt(log, "switch", `${CURRENT_LINK} to ${release}`, () =>
    pointCurrentAt(installRoot, version),
  );
}

async function attempt<T>(
  log: UpdateLog,
  step: UpdateStep,
  what: string,
  run: () => Promise<T> | T,
): Promise<T> {
  log.step(step, what);
  try {
    return await run();
  } catch (error) {
    throw new StepFailed(step, error);
  }
}

function fileNameOf(url: string): string {
  const name = decodeURIComponent(basename(new URL(url).pathname));
  if (!/^[\w.-]+$/.test(name)) throw new StepFailed("download", `${url} names no file.`);
  return name;
}

async function downloadTo(
  download: (url: string) => Promise<Response>,
  url: string,
  path: string,
): Promise<void> {
  const response = await download(url);
  if (!response.ok || !response.body) {
    throw new Error(`${url} answered ${response.status} ${response.statusText}.`);
  }
  await pipeline(
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
    createWriteStream(path),
  );
}

/** The checksum file's line, as `sha256sum` writes it, names the tarball and its sha256. */
async function verifyChecksum(tarball: string, checksum: string): Promise<void> {
  const line = readFileSync(checksum, "utf8").split("\n")[0] ?? "";
  const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim());
  if (!match) throw new Error(`${basename(checksum)} holds no sha256 line.`);
  const [, expected, name] = match;
  if (name !== basename(tarball)) {
    throw new Error(`${basename(checksum)} is the checksum of ${name}, not ${basename(tarball)}.`);
  }
  const actual = await sha256Of(tarball);
  if (actual !== expected) {
    throw new Error(`${basename(tarball)}'s sha256 is ${actual}, not ${expected}.`);
  }
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

function untar(tarball: string, folder: string, log: UpdateLog): Promise<void> {
  return new Promise((unpacked, reject) => {
    const child = spawn(
      "tar",
      ["--extract", "--gzip", "--file", tarball, "--directory", folder, "--no-same-owner"],
      { stdio: ["ignore", log.fd, log.fd] },
    );
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      code === 0
        ? unpacked()
        : reject(new Error(`tar ended with ${signal ?? `exit code ${code}`}.`)),
    );
  });
}

/** The tarball holds `the-office-<version>/` alone, whose stamp is of that version. */
function verifyUnpacked(unpacking: string, version: string): void {
  const top = `the-office-${version}`;
  const entries = readdirSync(unpacking);
  if (entries.length !== 1 || entries[0] !== top) {
    throw new Error(`The tarball holds ${entries.join(", ") || "nothing"}, not ${top} alone.`);
  }
  const stamp = JSON.parse(readFileSync(join(unpacking, top, RELEASE_STAMP_FILE), "utf8")) as {
    version?: unknown;
  };
  if (stamp.version !== version) {
    throw new Error(`The release's stamp says ${String(stamp.version)}, not ${version}.`);
  }
}

function isCurrent(installRoot: string, release: string): boolean {
  try {
    return realpathSync(join(installRoot, CURRENT_LINK)) === realpathSync(release);
  } catch {
    return false;
  }
}

/** Points `current` at `releases/<version>` in one rename, so it is never missing. */
function pointCurrentAt(installRoot: string, version: string): void {
  if (!existsSync(join(installRoot, RELEASES_FOLDER, version))) {
    throw new Error(`${join(installRoot, RELEASES_FOLDER, version)} isn't there.`);
  }
  const next = join(installRoot, `${CURRENT_LINK}.next`);
  rmSync(next, { force: true });
  symlinkSync(join(RELEASES_FOLDER, version), next);
  renameSync(next, join(installRoot, CURRENT_LINK));
}

/** The new version, once healthy; else it is stopped, and undefined. */
async function startNewVersion(
  { startService, health = { timeoutMs: HEALTH_TIMEOUT_MS } }: ReleaseUpdateOptions,
  healthUrl: string,
  { version }: ReleaseRequest,
  log: UpdateLog,
): Promise<RunningService | undefined> {
  log.step("start", `The Office ${version}, waiting for ${healthUrl}`);
  let service: RunningService;
  try {
    service = startService();
  } catch (error) {
    log.write(`== start failed: ${failure(error)}`);
    return undefined;
  }
  const outcome = await waitUntilHealthy(healthUrl, service.exited, health).catch(
    () => "exited" as const,
  );
  if (outcome === "healthy") {
    log.write(`== The Office ${version} is up.`);
    return service;
  }
  log.write(
    outcome === "exited"
      ? `== start failed: The Office ${version} ended before it was up.`
      : `== start failed: The Office ${version} wasn't up within ${health.timeoutMs / 1000} s.`,
  );
  await stopService(service).catch(() => undefined);
  return undefined;
}

/** Points `current` back at the version the update came from; whether it could. */
function switchBack(
  { installRoot }: ReleaseUpdateOptions,
  { from }: ReleaseRequest,
  log: UpdateLog,
): boolean {
  log.step("rollback", `${CURRENT_LINK} back to ${join(RELEASES_FOLDER, from)}`);
  try {
    pointCurrentAt(installRoot, from);
    return true;
  } catch (error) {
    log.write(`== rollback failed: ${failure(error)}`);
    return false;
  }
}

/** Keeps the new release, the one it came from and the launcher's own; removes the rest. */
function prune(
  { installRoot, launcherRelease }: ReleaseUpdateOptions,
  { version, from }: ReleaseRequest,
  log: UpdateLog,
): void {
  const releases = join(installRoot, RELEASES_FOLDER);
  const kept = new Set([version, from]);
  if (resolve(launcherRelease, "..") === resolve(releases)) kept.add(basename(launcherRelease));
  for (const entry of readdirSync(releases)) {
    if (kept.has(entry)) continue;
    try {
      rmSync(join(releases, entry), { recursive: true, force: true });
      log.write(`Removed ${join(releases, entry)}.`);
    } catch (error) {
      log.write(`${join(releases, entry)} wasn't removed: ${failure(error)}`);
    }
  }
}

function emptyDownloads(updateFolder: string): void {
  rmSync(join(updateFolder, DOWNLOADS_FOLDER), { recursive: true, force: true });
}
