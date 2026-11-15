import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { runLauncher, UPDATE_EXIT_CODE } from "./launcher.ts";
import { LOG_FILE, REQUEST_FILE, RESULT_FILE, type UpdateResult } from "./update-folder.ts";

// A service that asks for an update to TARGET on its first run, and ends on its second.
const FAKE_SERVICE = `
const { appendFileSync, existsSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const folder = process.env.OFFICE_UPDATE_FOLDER;
const runs = join(folder, "runs.txt");
const first = !existsSync(runs);
appendFileSync(runs, "run\\n");
if (first) {
  writeFileSync(join(folder, "${REQUEST_FILE}"), JSON.stringify({ target: process.env.TARGET }));
  process.exit(${UPDATE_EXIT_CODE});
}
`;

// Each commit's build: it records which commit it built, or fails where the commit says so.
const buildScript = (fails: boolean) =>
  fails
    ? "process.exit(1);\n"
    : 'require("node:fs").writeFileSync("built.txt", require("node:child_process").execSync("git rev-parse HEAD"));\n';

let root: string;
let checkout: string;
let updateFolder: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    {
      cwd,
      encoding: "utf8",
    },
  ).trim();
}

function commit(cwd: string, buildFails: boolean, subject: string): string {
  writeFileSync(join(cwd, "build.cjs"), buildScript(buildFails));
  writeFileSync(join(cwd, "subject.txt"), subject);
  git(cwd, "add", "build.cjs", "subject.txt");
  git(cwd, "commit", "--quiet", "-m", subject);
  return git(cwd, "rev-parse", "HEAD");
}

/** A newer commit on the upstream, which the checkout is behind. */
function pushNewerCommit(buildFails: boolean): string {
  const other = join(root, "other");
  git(root, "clone", "--quiet", join(root, "upstream.git"), other);
  const newer = commit(other, buildFails, "Newer");
  git(other, "push", "--quiet");
  return newer;
}

function launch(target: string) {
  const lines: string[] = [];
  const exitCode = runLauncher({
    install: {
      mode: "checkout",
      updateFolder,
      repository: checkout,
      commands: { install: ["node", "-e", ""], build: ["node", "build.cjs"] },
    },
    service: ["node", "-e", FAKE_SERVICE],
    serviceDirectory: () => checkout,
    environment: { ...process.env, TARGET: target },
    log: (line) => lines.push(line),
  });
  return { exitCode, lines };
}

function result(): UpdateResult {
  return JSON.parse(readFileSync(join(updateFolder, RESULT_FILE), "utf8")) as UpdateResult;
}

const runs = () =>
  readFileSync(join(updateFolder, "runs.txt"), "utf8").split("\n").filter(Boolean).length;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "office-launcher-"));
  checkout = join(root, "checkout");
  updateFolder = join(root, "data", "update");
  git(root, "init", "--quiet", "--bare", "--initial-branch=main", "upstream.git");
  git(root, "clone", "--quiet", join(root, "upstream.git"), checkout);
  writeFileSync(join(checkout, ".gitignore"), "built.txt\n");
  git(checkout, "add", ".gitignore");
  commit(checkout, false, "Older");
  git(checkout, "push", "--quiet", "--set-upstream", "origin", "main");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("an update fast-forwards to the target, builds it and starts the service again", async () => {
  const older = git(checkout, "rev-parse", "HEAD");
  const newer = pushNewerCommit(false);

  const { exitCode } = launch(newer);

  assert.equal(await exitCode, 0);
  assert.equal(git(checkout, "rev-parse", "HEAD"), newer);
  assert.equal(readFileSync(join(checkout, "built.txt"), "utf8").trim(), newer);
  assert.deepEqual(
    { ...result(), finishedAt: "" },
    { outcome: "updated", from: older, to: newer, finishedAt: "" },
  );
  assert.equal(runs(), 2);
  assert.equal(existsSync(join(updateFolder, REQUEST_FILE)), false);
  assert.match(readFileSync(join(updateFolder, LOG_FILE), "utf8"), /== build: node build\.cjs/);
});

test("a failed build goes back to the previous commit, builds it and starts it", async () => {
  const older = git(checkout, "rev-parse", "HEAD");
  const newer = pushNewerCommit(true);

  const { exitCode, lines } = launch(newer);

  assert.equal(await exitCode, 0);
  assert.equal(git(checkout, "rev-parse", "HEAD"), older);
  assert.equal(readFileSync(join(checkout, "built.txt"), "utf8").trim(), older);
  assert.deepEqual(
    { ...result(), finishedAt: "" },
    { outcome: "failed", from: older, to: newer, failedStep: "build", finishedAt: "" },
  );
  assert.equal(runs(), 2);
  assert.match(lines.join("\n"), /failed at build/);
  assert.match(
    readFileSync(join(updateFolder, LOG_FILE), "utf8"),
    /== rollback build ended with exit code 0/,
  );
});

test("a target the upstream doesn't have fails the update at the fast-forward", async () => {
  const older = git(checkout, "rev-parse", "HEAD");

  const { exitCode } = launch("0".repeat(40));

  assert.equal(await exitCode, 0);
  assert.equal(git(checkout, "rev-parse", "HEAD"), older);
  const ended = result();
  assert.equal(ended.outcome === "failed" && ended.failedStep, "merge");
});
