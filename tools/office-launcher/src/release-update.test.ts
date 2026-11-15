import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { runLauncher } from "./launcher.ts";
import { DOWNLOADS_FOLDER, REQUEST_FILE, RESULT_FILE, type UpdateResult } from "./update-folder.ts";

const FROM = "1.1.0";
const TO = "1.2.0";
const RELEASE_HOST = "https://releases.test";
const TARBALL = `the-office-${TO}-linux-x64.tar.gz`;

// A release's service: 1.1.0 asks for the update on its first run and ends on its next; 1.2.0
// answers /api/health and ends soon after, or never answers when its release says so.
const FAKE_SERVICE = `
const fs = require("node:fs");
const http = require("node:http");
const { join } = require("node:path");
const version = JSON.parse(fs.readFileSync("../../office-release.json", "utf8")).version;
fs.appendFileSync(process.env.RUNS, version + " " + process.env.OFFICE_INSTALL + "\\n");
const runs = fs.readFileSync(process.env.RUNS, "utf8").split("\\n").filter(Boolean).length;
if (version === "${FROM}") {
  if (runs === 1) {
    fs.writeFileSync(join(process.env.OFFICE_UPDATE_FOLDER, "${REQUEST_FILE}"), process.env.REQUEST);
    process.exit(75);
  }
  process.exit(0);
}
if (fs.existsSync("../../never-healthy")) setInterval(() => {}, 1000);
else
  http
    .createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end('{"database":"up"}');
      setTimeout(() => process.exit(0), 200);
    })
    .listen(Number(process.env.OFFICE_PORT), "127.0.0.1");
`;

let root: string;
let installRoot: string;
let updateFolder: string;
let served: string;
let server: Server;
let serverUrl: string;
let onTarballRequested: () => void;

function release(
  version: string,
  extra: Record<string, string> = {},
  folder = join(installRoot, "releases"),
): string {
  const path = join(folder, version);
  mkdirSync(join(path, "apps", "service"), { recursive: true });
  writeFileSync(join(path, "office-release.json"), JSON.stringify({ version }));
  for (const [file, text] of Object.entries(extra)) writeFileSync(join(path, file), text);
  return path;
}

/** The tarball of TO and its .sha256, served as RELEASE_HOST's files. */
function serveTarball({
  neverHealthy = false,
  checksum,
}: { neverHealthy?: boolean; checksum?: string } = {}): void {
  const stage = join(root, "stage");
  release(`the-office-${TO}`, neverHealthy ? { "never-healthy": "" } : {}, stage);
  writeFileSync(
    join(stage, `the-office-${TO}`, "office-release.json"),
    JSON.stringify({ version: TO }),
  );
  execFileSync("tar", [
    "--create",
    "--gzip",
    "--file",
    join(served, TARBALL),
    "--directory",
    stage,
    `the-office-${TO}`,
  ]);
  const sha256 = createHash("sha256")
    .update(readFileSync(join(served, TARBALL)))
    .digest("hex");
  writeFileSync(join(served, `${TARBALL}.sha256`), `${checksum ?? sha256}  ${TARBALL}\n`);
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function launch(): Promise<{ exitCode: number; lines: string[] }> {
  const lines: string[] = [];
  const request = {
    kind: "release",
    version: TO,
    from: FROM,
    tarballUrl: `${RELEASE_HOST}/${TARBALL}`,
    checksumUrl: `${RELEASE_HOST}/${TARBALL}.sha256`,
  };
  const exitCode = await runLauncher({
    install: {
      mode: "release",
      updateFolder,
      installRoot,
      launcherRelease: join(installRoot, "releases", "1.0.0"),
      health: { timeoutMs: 1500, intervalMs: 50 },
      download: (url) => fetch(url.replace(RELEASE_HOST, serverUrl)),
    },
    service: ["node", "-e", FAKE_SERVICE],
    serviceDirectory: () => join(realpathSync(join(installRoot, "current")), "apps", "service"),
    environment: {
      ...process.env,
      OFFICE_PORT: String(await freePort()),
      RUNS: join(root, "runs.txt"),
      REQUEST: JSON.stringify(request),
    },
    log: (line) => lines.push(line),
  });
  return { exitCode, lines };
}

const runs = () => readFileSync(join(root, "runs.txt"), "utf8").split("\n").filter(Boolean);
const current = () => readlinkSync(join(installRoot, "current"));
const result = () => ({
  ...(JSON.parse(readFileSync(join(updateFolder, RESULT_FILE), "utf8")) as UpdateResult),
  finishedAt: "",
});

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "office-release-update-"));
  installRoot = join(root, "opt");
  updateFolder = join(root, "data", "update");
  served = join(root, "served");
  mkdirSync(served);
  release("0.9.0");
  release("1.0.0");
  release(FROM);
  symlinkSync(join("releases", FROM), join(installRoot, "current"));
  onTarballRequested = () => undefined;
  server = createServer((request, response) => {
    const file = join(served, decodeURIComponent(request.url ?? "/").slice(1));
    if (request.url === `/${TARBALL}`) onTarballRequested();
    if (!existsSync(file)) {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
});

test("a release update switches current to the new version, starts it and prunes the rest", async () => {
  serveTarball();

  const { exitCode } = await launch();

  assert.equal(exitCode, 0);
  assert.equal(current(), join("releases", TO));
  assert.deepEqual(runs(), [`${FROM} release`, `${TO} release`]);
  assert.deepEqual(result(), { outcome: "updated", from: FROM, to: TO, finishedAt: "" });
  assert.deepEqual(readdirSync(join(installRoot, "releases")).toSorted(), ["1.0.0", FROM, TO]);
  assert.equal(existsSync(join(updateFolder, DOWNLOADS_FOLDER)), false);
});

test("a tarball whose sha256 doesn't match changes nothing, and the previous version starts", async () => {
  serveTarball({ checksum: "0".repeat(64) });

  const { exitCode, lines } = await launch();

  assert.equal(exitCode, 0);
  assert.equal(current(), join("releases", FROM));
  assert.deepEqual(result(), {
    outcome: "failed",
    from: FROM,
    to: TO,
    failedStep: "verify",
    finishedAt: "",
  });
  assert.deepEqual(runs(), [`${FROM} release`, `${FROM} release`]);
  assert.deepEqual(readdirSync(join(installRoot, "releases")).toSorted(), ["0.9.0", "1.0.0", FROM]);
  assert.match(lines.join("\n"), /failed at verify/);
});

test("a missing tarball fails the update at the download", async () => {
  const { exitCode } = await launch();

  assert.equal(exitCode, 0);
  assert.equal(current(), join("releases", FROM));
  const ended = result();
  assert.equal(ended.outcome === "failed" && ended.failedStep, "download");
});

test("a new version that never gets healthy is stopped, and current goes back to the previous one", async () => {
  serveTarball({ neverHealthy: true });

  const { exitCode } = await launch();

  assert.equal(exitCode, 0);
  assert.equal(current(), join("releases", FROM));
  assert.deepEqual(result(), {
    outcome: "failed",
    from: FROM,
    to: TO,
    failedStep: "start",
    finishedAt: "",
  });
  assert.deepEqual(runs(), [`${FROM} release`, `${TO} release`, `${FROM} release`]);
  assert.match(readFileSync(join(updateFolder, "log.txt"), "utf8"), /wasn't up within 1\.5 s/);
});

test("a stop signal mid-update lets the update finish, and runs nothing after it", async () => {
  serveTarball();
  onTarballRequested = () => void process.emit("SIGTERM");

  const { exitCode } = await launch();

  assert.equal(exitCode, 0);
  assert.equal(current(), join("releases", TO));
  assert.deepEqual(runs(), [`${FROM} release`, `${TO} release`]);
  assert.equal(result().outcome, "updated");
});
