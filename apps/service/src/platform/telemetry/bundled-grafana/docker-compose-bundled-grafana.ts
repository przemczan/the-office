import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { currentOperatingSystem } from "../../os/current-operating-system.js";
import { startProgram } from "../../os/program.js";
import {
  BUNDLED_GRAFANA_IMAGE,
  BUNDLED_GRAFANA_PROJECT,
  BundledGrafana,
  BundledGrafanaFailed,
  type BundledGrafanaProblem,
  type BundledGrafanaRunState,
} from "./bundled-grafana.js";

/** The file The Office writes its bundled Grafana's Compose project to, in the grafana folder. */
export const COMPOSE_FILE = "compose.yaml";

/** How long `up` waits for the healthcheck: pulling the image the first time can take minutes. */
export const UP_WAIT_SECONDS = 600;
/** The `up` process's own limit, above its wait, so compose itself reports a wait that ran out. */
export const UP_TIMEOUT_MS = (UP_WAIT_SECONDS + 60) * 1000;
/** Stopping waits out the container's own stop timeout. */
export const STOP_TIMEOUT_MS = 90_000;
/** A listing or an inspection. */
export const READ_TIMEOUT_MS = 30_000;

const logger = new Logger("DockerComposeBundledGrafana");

const DOCKER = "docker";
const ERROR_TAIL_CHARACTERS = 2000;
const STDOUT_LIMIT_CHARACTERS = 1024 * 1024;

/** One Docker CLI call, run from the grafana folder. */
export interface DockerCall {
  readonly arguments: readonly string[];
  readonly workingFolder: string;
  readonly timeoutMs: number;
}

/** How a Docker CLI call ended: its exit code, unless it didn't start or ran out of time. */
export interface DockerOutcome {
  readonly exitCode: number | undefined;
  readonly stdout: string;
  readonly errorTail: string;
  readonly ended?: "not-started" | "timeout";
}

export type RunDocker = (call: DockerCall) => Promise<DockerOutcome>;

/**
 * The bundled Grafana as Compose project `the-office-grafana`, from the compose file written to the
 * grafana folder. Every compose call names its project and file and runs from that folder, so it
 * never takes up another compose file.
 */
export class DockerComposeBundledGrafana extends BundledGrafana {
  private readonly composeFile: string;

  constructor(
    private readonly folder: string,
    private readonly runDocker: RunDocker = runDockerProgram,
  ) {
    super();
    this.composeFile = join(folder, COMPOSE_FILE);
  }

  async start(): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    await writeFile(this.composeFile, bundledGrafanaComposeFile());
    await this.required(
      [...this.compose(), "up", "--detach", "--wait", "--wait-timeout", String(UP_WAIT_SECONDS)],
      UP_TIMEOUT_MS,
      { kind: "not-healthy" },
    );
  }

  async stop(): Promise<void> {
    if (!(await this.composeFileExists())) return;
    await this.required([...this.compose(), "stop"], STOP_TIMEOUT_MS);
  }

  async state(): Promise<BundledGrafanaRunState> {
    if (!(await this.composeFileExists())) return "absent";
    const listed = await this.required(
      [...this.compose(), "ps", "--all", "--format", "json"],
      READ_TIMEOUT_MS,
    );
    return runStateOf(listed.stdout);
  }

  async earlierContainers(): Promise<readonly string[]> {
    const byCompose = await this.required(
      [
        "ps",
        "--filter",
        "label=com.docker.compose.project=the-office",
        "--filter",
        "label=com.docker.compose.service=otel-lgtm",
        "--format",
        "{{.Names}}",
      ],
      READ_TIMEOUT_MS,
    );
    const byName = await this.required(
      ["ps", "--filter", `name=^${BUNDLED_GRAFANA_PROJECT}$`, "--format", "{{.Names}}"],
      READ_TIMEOUT_MS,
    );
    return [...new Set([...linesOf(byCompose.stdout), ...linesOf(byName.stdout)])];
  }

  async stopEarlier(containers: readonly string[]): Promise<void> {
    if (containers.length === 0) return;
    await this.required(["stop", ...containers], STOP_TIMEOUT_MS);
  }

  private compose(): string[] {
    return ["compose", "--project-name", BUNDLED_GRAFANA_PROJECT, "--file", this.composeFile];
  }

  private async required(
    dockerArguments: readonly string[],
    timeoutMs: number,
    onTimeout: BundledGrafanaProblem = { kind: "docker-unreachable" },
  ): Promise<DockerOutcome> {
    await mkdir(this.folder, { recursive: true });
    const outcome = await this.runDocker({
      arguments: dockerArguments,
      workingFolder: this.folder,
      timeoutMs,
    });
    if (outcome.exitCode === 0) return outcome;
    switch (outcome.ended) {
      case "not-started":
        throw new BundledGrafanaFailed({ kind: "docker-unreachable" });
      case "timeout":
        throw new BundledGrafanaFailed(onTimeout);
      case undefined:
        throw new BundledGrafanaFailed(problemOf(outcome.errorTail));
    }
  }

  private composeFileExists(): Promise<boolean> {
    return access(this.composeFile).then(
      () => true,
      () => false,
    );
  }
}

/**
 * The bundled Grafana's compose file: on 127.0.0.1 alone, its data in a named volume, with a
 * healthcheck of its own for `up --wait` (the image's script, the intervals `deploy/compose` used),
 * and back after a reboot.
 */
export function bundledGrafanaComposeFile(): string {
  return `# Written by The Office at each start of its bundled Grafana (Settings › Telemetry).
name: ${BUNDLED_GRAFANA_PROJECT}

services:
  otel-lgtm:
    image: ${composeLiteral(BUNDLED_GRAFANA_IMAGE)}
    ports:
      - "127.0.0.1:3300:3000"
      - "127.0.0.1:4317:4317"
      - "127.0.0.1:4318:4318"
    volumes:
      - data:/data
    healthcheck:
      test: ["CMD", "/otel-lgtm/docker/healthcheck.sh"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 120s
      start_interval: 2s
    restart: unless-stopped

volumes:
  data: {}
`;
}

/** A value compose takes as it is: it reads `$` as the start of a variable, `$$` as a `$`. */
function composeLiteral(text: string): string {
  // A function, since "$$" in a replacement string means one "$".
  return text.replaceAll("$", () => "$$");
}

/** The card's problem from the end of the CLI's error output. */
export function problemOf(errorTail: string): BundledGrafanaProblem {
  const text = errorTail.toLowerCase();
  if (
    text.includes("cannot connect to the docker daemon") ||
    text.includes("docker.sock") ||
    text.includes("is the docker daemon running") ||
    text.includes("not found: docker") ||
    text.includes("'compose' is not a docker command") ||
    text.includes("unknown command")
  ) {
    return { kind: "docker-unreachable" };
  }
  if (
    text.includes("port is already allocated") ||
    text.includes("address already in use") ||
    text.includes("ports are not available")
  ) {
    return { kind: "port-taken" };
  }
  if (
    text.includes("pull access denied") ||
    text.includes("manifest unknown") ||
    text.includes("failed to resolve reference") ||
    text.includes("error pulling") ||
    text.includes("toomanyrequests") ||
    text.includes("no such host")
  ) {
    return { kind: "image-not-pulled" };
  }
  if (text.includes("unhealthy")) return { kind: "not-healthy" };
  const lastLine = errorTail.trim().split("\n").at(-1)?.trim();
  return { kind: "other", detail: lastLine || "it ended with no message." };
}

interface ListedContainer {
  readonly State?: string;
  readonly Health?: string;
}

/** The project's state from `compose ps --all --format json`: a JSON line per container, or an array. */
export function runStateOf(listing: string): BundledGrafanaRunState {
  const containers = parseListing(listing);
  const container = containers[0];
  if (container === undefined) return "absent";
  if (container.State !== "running") return "stopped";
  switch (container.Health) {
    case "starting":
      return "starting";
    case "unhealthy":
      return "unhealthy";
    default:
      return "running";
  }
}

function parseListing(listing: string): ListedContainer[] {
  const trimmed = listing.trim();
  if (trimmed === "") return [];
  if (trimmed.startsWith("[")) return JSON.parse(trimmed) as ListedContainer[];
  return linesOf(trimmed).map((line) => JSON.parse(line) as ListedContainer);
}

function linesOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Runs the Docker CLI without a shell, ending it with what it started once `timeoutMs` passes. */
export async function runDockerProgram(call: DockerCall): Promise<DockerOutcome> {
  const { processTrees } = currentOperatingSystem();
  const child = startProgram(
    {
      command: DOCKER,
      arguments: call.arguments,
      workingFolder: call.workingFolder,
      environment: dockerEnvironment(),
    },
    processTrees,
  );
  let stdout = "";
  let errorTail = "";
  child.stdout.on("data", (chunk: Buffer) => {
    if (stdout.length < STDOUT_LIMIT_CHARACTERS) stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    errorTail = (errorTail + chunk.toString()).slice(-ERROR_TAIL_CHARACTERS);
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid === undefined) return;
    void processTrees.end(child.pid).catch((error: unknown) => {
      logger.warn(`Docker, which ran out of time, wasn't ended: ${String(error)}`);
    });
  }, call.timeoutMs);
  const ended = await new Promise<{ exitCode: number | undefined; notStarted?: Error }>(
    (resolve) => {
      child.once("error", (error) => resolve({ exitCode: undefined, notStarted: error }));
      child.once("close", (code) => resolve({ exitCode: code ?? undefined }));
    },
  );
  clearTimeout(timer);
  if (ended.notStarted) {
    return {
      exitCode: undefined,
      stdout,
      errorTail: `${errorTail}\n${ended.notStarted.message}`.trim(),
      ended: "not-started",
    };
  }
  return timedOut
    ? { exitCode: undefined, stdout, errorTail: errorTail.trim(), ended: "timeout" }
    : { exitCode: ended.exitCode, stdout, errorTail: errorTail.trim() };
}

/**
 * The service's own environment, without what would point compose at another project or file:
 * every call names its project and file itself.
 */
function dockerEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !entry[0].startsWith("COMPOSE_"),
    ),
  );
}
