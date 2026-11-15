// An Office update of a Docker Compose install, as the Office updater runs it: a short-lived
// container The Office starts from its own image (docs/running-the-office.md). It pulls the new
// version's image, sets OFFICE_VERSION in the compose folder's .env, recreates the office service
// and waits for it to be healthy; otherwise it puts the previous version back.
import { chownSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Command } from "./office-update.ts";
import { HEALTH_TIMEOUT_MS, type HealthWait } from "./service-health.ts";
import {
  failure,
  LOG_FILE,
  RESULT_FILE,
  takeRequest,
  UpdateLog,
  writeResult,
  type ContainerRequest,
  type UpdateResult,
  type UpdateStep,
} from "./update-folder.ts";

/** The variable holding the image's tag in the compose folder's .env. */
export const VERSION_VARIABLE = "OFFICE_VERSION";

export interface CommandOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a command to its end; the real one runs docker, a test's answers from a script. */
export type CommandRunner = (command: Command) => Promise<CommandOutput>;

export interface ContainerUpdateOptions {
  readonly updateFolder: string;
  /** The Office container's id, which the service gave the updater. */
  readonly container: string;
  readonly run: CommandRunner;
  readonly health?: HealthWait;
}

/** What Docker Compose labels its containers with: the project the Office container belongs to. */
export interface ComposeProject {
  readonly project: string;
  readonly service: string;
  readonly workingDir: string;
  readonly configFiles: readonly string[];
  readonly environmentFiles: readonly string[];
}

const LABEL = "com.docker.compose";

/** The compose project of a container, from `docker inspect`'s JSON; throws when it has none. */
export function composeProjectOf(inspectJson: string): ComposeProject {
  const [container] = JSON.parse(inspectJson) as {
    Config?: { Labels?: Record<string, string> | null };
  }[];
  const labels = container?.Config?.Labels ?? {};
  const list = (name: string) =>
    (labels[name] ?? "")
      .split(",")
      .map((each) => each.trim())
      .filter(Boolean);
  const project = labels[`${LABEL}.project`];
  const service = labels[`${LABEL}.service`];
  const workingDir = labels[`${LABEL}.project.working_dir`];
  const configFiles = list(`${LABEL}.project.config_files`);
  if (!project || !service || !workingDir || configFiles.length === 0) {
    throw new Error("The Office container wasn't started by Docker Compose.");
  }
  return {
    project,
    service,
    workingDir,
    configFiles,
    environmentFiles: list(`${LABEL}.project.environment_file`),
  };
}

/** `docker compose` for the project, with the files and env files it was started with. */
export function composeCommand(project: ComposeProject, ...args: string[]): Command {
  return [
    "docker",
    "compose",
    "-p",
    project.project,
    "--project-directory",
    project.workingDir,
    ...project.configFiles.flatMap((file) => ["-f", file]),
    ...project.environmentFiles.flatMap((file) => ["--env-file", file]),
    ...args,
  ];
}

const VARIABLE_LINE = (name: string) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);

/** `text` of an env file with `name` set to `value`, every other line as it was. */
export function withVariable(text: string, name: string, value: string): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const matches = VARIABLE_LINE(name);
  let found = false;
  const set = lines.map((line) => {
    if (!matches.test(line)) return line;
    found = true;
    return `${name}=${value}`;
  });
  if (found) return set.join(newline);
  const ending = text === "" || text.endsWith("\n") ? "" : newline;
  return `${text}${ending}${name}=${value}${newline}`;
}

/** The env file holding OFFICE_VERSION: the one Compose names that sets it, else `.env`. */
function environmentFileOf(project: ComposeProject): string {
  const sets = VARIABLE_LINE(VERSION_VARIABLE);
  const holding = project.environmentFiles.find(
    (file) =>
      existsSync(file) &&
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .some((line) => sets.test(line)),
  );
  return holding ?? project.environmentFiles[0] ?? join(project.workingDir, ".env");
}

class StepFailed extends Error {
  readonly step: UpdateStep;

  constructor(step: UpdateStep, message: string) {
    super(message);
    this.step = step;
  }
}

/**
 * Runs the container update `request.json` asks for; undefined when nothing was asked. `result.json`
 * says how it went, written `updated` before the office service is recreated, so the new version
 * reads it at boot; both it and `log.txt` are left to the update folder's owner, the service's user.
 */
export async function runContainerUpdate(
  options: ContainerUpdateOptions,
): Promise<UpdateResult | undefined> {
  const request = takeRequest(options.updateFolder);
  if (!request) return undefined;
  if (request.kind !== "container") {
    throw new Error(`The Office updater updates a container, not a ${request.kind}.`);
  }
  const log = new UpdateLog(options.updateFolder);
  try {
    return await new ContainerUpdate(options, request, log).run();
  } finally {
    log.close();
    giveToFolderOwner(options.updateFolder);
  }
}

class ContainerUpdate {
  private readonly options: ContainerUpdateOptions;
  private readonly request: ContainerRequest;
  private readonly log: UpdateLog;

  constructor(options: ContainerUpdateOptions, request: ContainerRequest, log: UpdateLog) {
    this.options = options;
    this.request = request;
    this.log = log;
  }

  async run(): Promise<UpdateResult> {
    const { version } = this.request;
    let project: ComposeProject;
    let environmentFile: string;
    let original: string;
    try {
      const inspected = await this.step("download", ["docker", "inspect", this.options.container]);
      project = this.attempt("download", () => composeProjectOf(inspected));
      await this.step("download", ["docker", "pull", `${this.request.image}:${version}`]);
      environmentFile = environmentFileOf(project);
      original = existsSync(environmentFile) ? readFileSync(environmentFile, "utf8") : "";
      await this.switchTo(project, environmentFile, original);
    } catch (error) {
      return this.failed(error);
    }
    // Written once, before the recreate: the new container may take it as it boots.
    const updated = this.finish({ outcome: "updated" });
    try {
      await this.step("start", composeCommand(project, "up", "-d", "--no-deps", project.service));
      await this.waitUntilHealthy(project);
      this.log.write(`== The Office ${version} is up.`);
      return updated;
    } catch (error) {
      this.log.write(`== start failed: ${failure(error)}`);
      // Before the previous version is recreated, which reads it at boot.
      const failed = this.finish({ outcome: "failed", failedStep: "start" });
      if (await this.rollBack(project, environmentFile, original)) return failed;
      return this.finish({ outcome: "failed", failedStep: "start", rollbackFailed: true });
    }
  }

  /** Sets OFFICE_VERSION in place, so the file keeps its owner and mode, and checks Compose reads it. */
  private async switchTo(
    project: ComposeProject,
    environmentFile: string,
    original: string,
  ): Promise<void> {
    const { version } = this.request;
    this.log.step("switch", `${VERSION_VARIABLE}=${version} in ${environmentFile}`);
    this.attempt("switch", () =>
      writeFileSync(environmentFile, withVariable(original, VERSION_VARIABLE, version)),
    );
    try {
      const config = await this.step(
        "switch",
        composeCommand(project, "config", "--format", "json"),
      );
      const image = this.attempt("switch", () => {
        const services = (JSON.parse(config) as { services?: Record<string, { image?: string }> })
          .services;
        return services?.[project.service]?.image;
      });
      if (!image?.endsWith(`:${version}`)) {
        throw new StepFailed(
          "switch",
          `Docker Compose gives the ${project.service} service the image ${image ?? "(none)"}, not one tagged ${version}: does docker-compose.yml take its tag from ${VERSION_VARIABLE}?`,
        );
      }
    } catch (error) {
      writeFileSync(environmentFile, original);
      this.log.write(`Put ${environmentFile} back as it was.`);
      throw error;
    }
  }

  private async waitUntilHealthy(project: ComposeProject): Promise<void> {
    const { timeoutMs, intervalMs = 2000 } = this.options.health ?? {
      timeoutMs: HEALTH_TIMEOUT_MS,
    };
    const deadline = Date.now() + timeoutMs;
    const id = (await this.step("start", composeCommand(project, "ps", "-q", project.service)))
      .trim()
      .split("\n")[0];
    if (!id) throw new Error(`Docker Compose runs no ${project.service} container.`);
    for (;;) {
      const status = (
        await this.step("start", ["docker", "inspect", "--format", "{{.State.Health.Status}}", id])
      ).trim();
      if (status === "healthy") return;
      if (status === "unhealthy")
        throw new Error(`The new ${project.service} container is unhealthy.`);
      if (Date.now() >= deadline) {
        throw new Error(
          `The new ${project.service} container wasn't healthy within ${timeoutMs / 1000} s.`,
        );
      }
      await delay(intervalMs);
    }
  }

  /** Puts the .env back as it was and recreates the office service from it; whether it could. */
  private async rollBack(
    project: ComposeProject,
    environmentFile: string,
    original: string,
  ): Promise<boolean> {
    this.log.step("rollback", `${VERSION_VARIABLE}=${this.request.from} in ${environmentFile}`);
    try {
      writeFileSync(environmentFile, original);
      await this.step(
        "rollback",
        composeCommand(project, "up", "-d", "--no-deps", project.service),
      );
      return true;
    } catch (error) {
      this.log.write(`== rollback failed: ${failure(error)}`);
      return false;
    }
  }

  /** Runs a step's command with its output in the log; its stdout, or a StepFailed. */
  private async step(step: UpdateStep | "rollback", command: Command): Promise<string> {
    this.log.step(step, command.join(" "));
    let output: CommandOutput;
    try {
      output = await this.options.run(command);
    } catch (error) {
      throw new StepFailed(step === "rollback" ? "start" : step, failure(error));
    }
    if (output.stdout) this.log.write(output.stdout.trimEnd());
    if (output.stderr) this.log.write(output.stderr.trimEnd());
    this.log.write(`== ${step} ended with exit code ${output.exitCode}`);
    if (output.exitCode !== 0) {
      throw new StepFailed(
        step === "rollback" ? "start" : step,
        `${command.slice(0, 3).join(" ")} … ended with exit code ${output.exitCode}.`,
      );
    }
    return output.stdout;
  }

  private attempt<T>(step: UpdateStep, run: () => T): T {
    try {
      return run();
    } catch (error) {
      if (error instanceof StepFailed) throw error;
      throw new StepFailed(step, failure(error));
    }
  }

  private failed(error: unknown): UpdateResult {
    const step = error instanceof StepFailed ? error.step : "download";
    this.log.write(`== ${step} failed: ${failure(error)}`);
    return this.finish({ outcome: "failed", failedStep: step });
  }

  private finish(
    ending:
      | { readonly outcome: "updated" }
      | {
          readonly outcome: "failed";
          readonly failedStep: UpdateStep;
          readonly rollbackFailed?: true;
        },
  ): UpdateResult {
    const result: UpdateResult = {
      ...ending,
      from: this.request.from,
      to: this.request.version,
      finishedAt: new Date().toISOString(),
    };
    writeResult(this.options.updateFolder, result);
    return result;
  }
}

/** The updater runs as root; the service, as the folder's owner, reads and moves what it left. */
function giveToFolderOwner(updateFolder: string): void {
  const { uid, gid } = statSync(updateFolder);
  for (const file of [RESULT_FILE, LOG_FILE]) {
    const path = join(updateFolder, file);
    if (existsSync(path)) chownSync(path, uid, gid);
  }
}
