import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  composeProjectOf,
  runContainerUpdate,
  withVariable,
  type CommandOutput,
} from "./container-update.ts";
import type { Command } from "./office-update.ts";
import { LOG_FILE, REQUEST_FILE, RESULT_FILE, type UpdateResult } from "./update-folder.ts";

const IMAGE = "ghcr.io/owner/the-office";
const ENV_FILE_TEXT =
  "POSTGRES_PASSWORD=secret\nOFFICE_VERSION=1.1.0\n# the port\nOFFICE_PORT=4310\n";

let root: string;
let updateFolder: string;
let composeFolder: string;
let envFile: string;

function inspected(labels: Record<string, string>): string {
  return JSON.stringify([{ Id: "office", Config: { Labels: labels } }]);
}

const composeLabels = () => ({
  "com.docker.compose.project": "the-office",
  "com.docker.compose.service": "office",
  "com.docker.compose.project.working_dir": composeFolder,
  "com.docker.compose.project.config_files": join(composeFolder, "docker-compose.yml"),
});

interface Script {
  readonly labels?: Record<string, string>;
  /** The image Compose gives the office service, from the .env as it is now. */
  readonly image?: () => string;
  readonly healthStatuses?: string[];
  /** The `up` calls' exit codes, in order. */
  readonly upExitCodes?: number[];
}

function answer(stdout = "", exitCode = 0): CommandOutput {
  return { exitCode, stdout, stderr: "" };
}

/** A docker that answers as the script says, keeping every command it was given. */
function scriptedDocker({
  labels = composeLabels(),
  image,
  healthStatuses = ["starting", "healthy"],
  upExitCodes = [],
}: Script) {
  const commands: string[] = [];
  const run = async (command: Command): Promise<CommandOutput> => {
    const line = command.join(" ");
    commands.push(line);
    if (line === "docker inspect office") return answer(inspected(labels));
    if (line.startsWith("docker pull ")) return answer("pulled");
    if (line.endsWith("config --format json")) {
      const version = /^OFFICE_VERSION=(.*)$/m.exec(readFileSync(envFile, "utf8"))?.[1];
      return answer(
        JSON.stringify({ services: { office: { image: image?.() ?? `${IMAGE}:${version}` } } }),
      );
    }
    if (line.includes(" up -d --no-deps office")) return answer("", upExitCodes.shift() ?? 0);
    if (line.endsWith("ps -q office")) return answer("new-office\n");
    if (line.startsWith("docker inspect --format"))
      return answer(`${healthStatuses.shift() ?? "starting"}\n`);
    return answer("", 1);
  };
  return { run, commands };
}

async function update(script: Script = {}) {
  const docker = scriptedDocker(script);
  const result = await runContainerUpdate({
    updateFolder,
    container: "office",
    run: docker.run,
    health: { timeoutMs: 50, intervalMs: 1 },
  });
  return { result, commands: docker.commands };
}

const withoutTime = (result: UpdateResult | undefined) => result && { ...result, finishedAt: "" };
const resultFile = () =>
  JSON.parse(readFileSync(join(updateFolder, RESULT_FILE), "utf8")) as UpdateResult;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "office-updater-"));
  updateFolder = join(root, "data", "update");
  composeFolder = join(root, "compose");
  envFile = join(composeFolder, ".env");
  mkdirSync(updateFolder, { recursive: true });
  mkdirSync(composeFolder);
  writeFileSync(envFile, ENV_FILE_TEXT);
  chmodSync(envFile, 0o640);
  writeFileSync(
    join(updateFolder, REQUEST_FILE),
    JSON.stringify({ kind: "container", version: "1.2.0", from: "1.1.0", image: IMAGE }),
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the Office updater", () => {
  test("pulls the image, sets OFFICE_VERSION, recreates the office service and waits for it to be healthy", async () => {
    const { result, commands } = await update();

    const compose = `docker compose -p the-office --project-directory ${composeFolder} -f ${join(composeFolder, "docker-compose.yml")}`;
    assert.deepEqual(commands, [
      "docker inspect office",
      `docker pull ${IMAGE}:1.2.0`,
      `${compose} config --format json`,
      `${compose} up -d --no-deps office`,
      `${compose} ps -q office`,
      "docker inspect --format {{.State.Health.Status}} new-office",
      "docker inspect --format {{.State.Health.Status}} new-office",
    ]);
    assert.deepEqual(withoutTime(result), {
      outcome: "updated",
      from: "1.1.0",
      to: "1.2.0",
      finishedAt: "",
    });
    assert.equal(
      readFileSync(envFile, "utf8"),
      ENV_FILE_TEXT.replace("OFFICE_VERSION=1.1.0", "OFFICE_VERSION=1.2.0"),
    );
    assert.equal(statSync(envFile).mode & 0o777, 0o640);
    assert.equal(resultFile().outcome, "updated");
    assert.match(
      readFileSync(join(updateFolder, LOG_FILE), "utf8"),
      /== start: .* up -d --no-deps office/,
    );
  });

  test("puts the .env back and recreates nothing when Compose doesn't take the tag from it", async () => {
    const { result, commands } = await update({ image: () => `${IMAGE}:latest` });

    assert.deepEqual(withoutTime(result), {
      outcome: "failed",
      from: "1.1.0",
      to: "1.2.0",
      failedStep: "switch",
      finishedAt: "",
    });
    assert.equal(readFileSync(envFile, "utf8"), ENV_FILE_TEXT);
    assert.equal(
      commands.some((command) => command.includes(" up ")),
      false,
    );
  });

  test("puts the previous version back when the new one isn't healthy in time", async () => {
    const { result, commands } = await update({ healthStatuses: [] });

    assert.deepEqual(withoutTime(result), {
      outcome: "failed",
      from: "1.1.0",
      to: "1.2.0",
      failedStep: "start",
      finishedAt: "",
    });
    assert.equal(readFileSync(envFile, "utf8"), ENV_FILE_TEXT);
    assert.equal(
      commands.filter((command) => command.includes(" up -d --no-deps office")).length,
      2,
    );
    assert.equal(resultFile().outcome, "failed");
  });

  test("says the rollback failed too when the previous version can't be recreated", async () => {
    const { result } = await update({ healthStatuses: ["unhealthy"], upExitCodes: [0, 1] });

    assert.equal(result?.outcome === "failed" && result.rollbackFailed, true);
    const written = resultFile();
    assert.equal(written.outcome === "failed" && written.rollbackFailed, true);
  });

  test("fails at the download, changing nothing, for a container Compose didn't start", async () => {
    const { result, commands } = await update({ labels: {} });

    assert.equal(result?.outcome === "failed" && result.failedStep, "download");
    assert.deepEqual(commands, ["docker inspect office"]);
    assert.equal(readFileSync(envFile, "utf8"), ENV_FILE_TEXT);
  });
});

describe("the compose project and its .env", () => {
  test("come from the labels Compose sets", () => {
    const project = composeProjectOf(
      inspected({
        ...composeLabels(),
        "com.docker.compose.project.config_files":
          "/srv/office/docker-compose.yml,/srv/office/override.yml",
        "com.docker.compose.project.environment_file": "/srv/office/.env",
      }),
    );

    assert.deepEqual(project.configFiles, [
      "/srv/office/docker-compose.yml",
      "/srv/office/override.yml",
    ]);
    assert.deepEqual(project.environmentFiles, ["/srv/office/.env"]);
  });

  test("OFFICE_VERSION is set in place, or added, every other line kept", () => {
    assert.equal(
      withVariable("A=1\nOFFICE_VERSION=1.0.0\nB=2\n", "OFFICE_VERSION", "1.2.0"),
      "A=1\nOFFICE_VERSION=1.2.0\nB=2\n",
    );
    assert.equal(withVariable("A=1", "OFFICE_VERSION", "1.2.0"), "A=1\nOFFICE_VERSION=1.2.0\n");
    assert.equal(
      withVariable("A=1\r\n", "OFFICE_VERSION", "1.2.0"),
      "A=1\r\nOFFICE_VERSION=1.2.0\r\n",
    );
  });
});
