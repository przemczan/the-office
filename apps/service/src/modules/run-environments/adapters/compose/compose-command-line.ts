import { Injectable } from "@nestjs/common";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { finished } from "node:stream/promises";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { startProgram } from "../../../../platform/os/program.js";
import { LABEL, type Labels } from "../../domain/run-environment.js";
import {
  ContainerRuntime,
  ContainerRuntimeFailed,
  type ComposeProject,
  type Execution,
  type ExecutionEnd,
  type ImageBuild,
  type LabelledImage,
  type LabelledResource,
  type ResourceKind,
} from "../../ports/container-runtime.js";

/** The container runtime's CLI, Docker Engine with its Compose plugin (docs/container-runtime.md). */
const RUNTIME = "docker";

/** How long a short command, such as a listing, may take. */
const SHORT_TIMEOUT_MS = 2 * 60 * 1000;
/** How long building an image or starting a compose project may take. */
const LONG_TIMEOUT_MS = 60 * 60 * 1000;
/** How long `up` waits for the services to be running, or healthy where they have a healthcheck. */
const UP_WAIT_SECONDS = 600;
/** The end of a failing command's error output kept for its message. */
const ERROR_TAIL_BYTES = 4096;
/** The most a listing's output may hold. */
const LISTING_LIMIT_BYTES = 8 * 1024 * 1024;

const LISTED_LABELS = Object.values(LABEL);

interface Invocation {
  readonly arguments: readonly string[];
  readonly timeoutMs: number;
  /** Streams stdout and stderr there; else stdout is kept, for a listing. */
  readonly outputFile?: string;
  readonly signal?: AbortSignal;
  readonly workingFolder?: string;
}

interface Ended {
  readonly exitCode: number | undefined;
  readonly endedBy?: "timeout" | "stop";
  readonly stdout: string;
  readonly errorTail: string;
}

/**
 * The container runtime through its compose CLI, a process per command: never through a shell, so
 * no name or label is read as more of a command line. Long output goes straight to its file.
 */
@Injectable()
export class ComposeCommandLine extends ContainerRuntime {
  private readonly operatingSystem = currentOperatingSystem();
  /**
   * Where commands naming no compose file run: an empty folder, so compose never takes up a compose
   * file found in the service's own folder.
   */
  private readonly neutralFolder = join(tmpdir(), "the-office-compose");

  async imageExists(image: string): Promise<boolean> {
    const { exitCode } = await this.invoke({
      arguments: ["image", "inspect", "--format", "{{.Id}}", image],
      timeoutMs: SHORT_TIMEOUT_MS,
    });
    return exitCode === 0;
  }

  async buildImage(build: ImageBuild, outputFile: string): Promise<void> {
    await this.required(`The image ${build.image} couldn't be built`, {
      arguments: [
        "build",
        "--progress",
        "plain",
        "--tag",
        build.image,
        "--file",
        join(build.context, build.dockerfile),
        ...labelArguments(build.labels),
        ...Object.entries(build.args).flatMap(([name, value]) => [
          "--build-arg",
          `${name}=${value}`,
        ]),
        ...(build.target === undefined ? [] : ["--target", build.target]),
        build.context,
      ],
      timeoutMs: LONG_TIMEOUT_MS,
      outputFile,
    });
  }

  async up(project: ComposeProject, outputFile: string): Promise<void> {
    await this.required(`The compose project ${project.name} couldn't start`, {
      arguments: [
        ...composeArguments(project),
        "up",
        "--detach",
        "--wait",
        "--wait-timeout",
        String(UP_WAIT_SECONDS),
        "--remove-orphans",
        "--quiet-pull",
        ...project.services,
      ],
      timeoutMs: LONG_TIMEOUT_MS,
      outputFile,
      workingFolder: project.projectDirectory,
    });
  }

  async stop(projectName: string): Promise<void> {
    await this.required(`The compose project ${projectName} couldn't stop`, {
      arguments: ["compose", "--project-name", projectName, "stop"],
      timeoutMs: SHORT_TIMEOUT_MS,
    });
  }

  async exec(
    project: ComposeProject,
    execution: Execution,
    outputFile: string,
  ): Promise<ExecutionEnd> {
    const ended = await this.invoke({
      arguments: [
        ...composeArguments(project),
        "exec",
        "--no-TTY",
        ...(execution.user === undefined ? [] : ["--user", execution.user]),
        execution.service,
        "/bin/sh",
        "-c",
        execution.script,
      ],
      timeoutMs: execution.timeoutMs,
      outputFile,
      workingFolder: project.projectDirectory,
      ...(execution.signal === undefined ? {} : { signal: execution.signal }),
    });
    if (ended.endedBy !== undefined) {
      // Ending the CLI leaves the command running in the container: restarting the service ends it.
      await this.required(`The service ${execution.service} couldn't be restarted`, {
        arguments: [...composeArguments(project), "restart", execution.service],
        timeoutMs: SHORT_TIMEOUT_MS,
        workingFolder: project.projectDirectory,
      });
      return { exitCode: undefined, endedBy: ended.endedBy };
    }
    if (ended.exitCode === undefined) {
      throw new ContainerRuntimeFailed(`The check couldn't run. ${ended.errorTail}`.trim());
    }
    return { exitCode: ended.exitCode };
  }

  async down(projectName: string): Promise<void> {
    await this.required(`The compose project ${projectName} couldn't be removed`, {
      arguments: [
        "compose",
        "--project-name",
        projectName,
        "down",
        "--volumes",
        "--remove-orphans",
        "--timeout",
        "10",
      ],
      timeoutMs: SHORT_TIMEOUT_MS,
    });
  }

  async listByLabel(labels: Labels): Promise<readonly LabelledResource[]> {
    const lists = await Promise.all(
      (["container", "network", "volume"] as const).map((kind) => this.listed(kind, labels)),
    );
    return lists.flat();
  }

  async removeByLabel(labels: Labels): Promise<void> {
    const resources = await this.listByLabel(labels);
    const ids = (kind: ResourceKind): string[] =>
      resources.filter((resource) => resource.kind === kind).map(({ id }) => id);
    const removals = [
      ["container", ["container", "rm", "--force", "--volumes"]],
      ["network", ["network", "rm"]],
      ["volume", ["volume", "rm", "--force"]],
    ] as const;
    for (const [kind, command] of removals) {
      const found = ids(kind);
      if (found.length === 0) continue;
      await this.required(`The ${kind}s labelled ${describe(labels)} couldn't be removed`, {
        arguments: [...command, ...found],
        timeoutMs: SHORT_TIMEOUT_MS,
      });
    }
  }

  async listImages(labels: Labels): Promise<readonly LabelledImage[]> {
    const { stdout } = await this.required("The images couldn't be listed", {
      arguments: [
        "image",
        "ls",
        ...filterArguments(labels),
        "--format",
        "{{.Repository}}:{{.Tag}}\t{{.CreatedAt}}",
      ],
      timeoutMs: SHORT_TIMEOUT_MS,
    });
    return lines(stdout).flatMap((line) => {
      const [name = "", createdAt = ""] = line.split("\t");
      if (name.includes("<none>")) return [];
      return [{ name, createdAt: dateOf(createdAt) }];
    });
  }

  async removeImage(image: string): Promise<void> {
    await this.required(`The image ${image} couldn't be removed`, {
      arguments: ["image", "rm", image],
      timeoutMs: SHORT_TIMEOUT_MS,
    });
  }

  private async listed(kind: ResourceKind, labels: Labels): Promise<readonly LabelledResource[]> {
    const id = kind === "volume" ? "{{.Name}}" : "{{.ID}}";
    const format = [id, ...LISTED_LABELS.map((label) => `{{.Label "${label}"}}`)].join("\t");
    const { stdout } = await this.required(`The ${kind}s couldn't be listed`, {
      arguments: [
        kind,
        "ls",
        ...(kind === "container" ? ["--all", "--no-trunc"] : []),
        ...filterArguments(labels),
        "--format",
        format,
      ],
      timeoutMs: SHORT_TIMEOUT_MS,
    });
    return lines(stdout).map((line) => {
      const [resourceId = "", ...values] = line.split("\t");
      const found = LISTED_LABELS.flatMap((label, index) => {
        const value = values[index] ?? "";
        return value === "" ? [] : [[label, value] as const];
      });
      return { kind, id: resourceId, labels: Object.fromEntries(found) };
    });
  }

  /** Runs the command and throws ContainerRuntimeFailed unless it exits with 0. */
  private async required(what: string, invocation: Invocation): Promise<Ended> {
    const ended = await this.invoke(invocation);
    if (ended.exitCode === 0) return ended;
    const why =
      ended.endedBy === "timeout"
        ? "It took too long."
        : ended.endedBy === "stop"
          ? "It was stopped."
          : ended.errorTail;
    throw new ContainerRuntimeFailed(`${what}. ${why}`.trim());
  }

  private async invoke(invocation: Invocation): Promise<Ended> {
    if (invocation.signal?.aborted) {
      return { exitCode: undefined, endedBy: "stop", stdout: "", errorTail: "" };
    }
    const workingFolder = invocation.workingFolder ?? this.neutralFolder;
    await mkdir(workingFolder, { recursive: true });
    const output = invocation.outputFile ? await appendingTo(invocation.outputFile) : undefined;
    const { processTrees } = this.operatingSystem;
    const child = startProgram(
      {
        command: RUNTIME,
        arguments: invocation.arguments,
        workingFolder,
        environment: runtimeEnvironment(),
      },
      processTrees,
    );
    const stdout = new BoundedText(LISTING_LIMIT_BYTES);
    const errorTail = new BoundedText(ERROR_TAIL_BYTES);
    child.stdout.on("data", (chunk: Buffer) => (output ? output.write(chunk) : stdout.add(chunk)));
    child.stderr.on("data", (chunk: Buffer) => {
      output?.write(chunk);
      errorTail.add(chunk);
    });

    let endedBy: "timeout" | "stop" | undefined;
    const end = (reason: "timeout" | "stop"): void => {
      endedBy ??= reason;
      if (child.pid !== undefined) void processTrees.end(child.pid);
    };
    const timer = setTimeout(() => end("timeout"), invocation.timeoutMs);
    const stop = (): void => end("stop");
    invocation.signal?.addEventListener("abort", stop, { once: true });

    const exitCode = await new Promise<number | undefined>((resolve) => {
      child.once("error", (error) => {
        errorTail.add(Buffer.from(notStarted(error)));
        resolve(undefined);
      });
      child.once("close", (code) => resolve(code ?? undefined));
    });
    clearTimeout(timer);
    invocation.signal?.removeEventListener("abort", stop);
    if (output) {
      output.end();
      await finished(output);
    }
    return {
      exitCode: endedBy === undefined ? exitCode : undefined,
      ...(endedBy === undefined ? {} : { endedBy }),
      stdout: stdout.text(),
      errorTail: errorTail.text().trim(),
    };
  }
}

function composeArguments(project: ComposeProject): string[] {
  return [
    "compose",
    "--project-name",
    project.name,
    "--project-directory",
    project.projectDirectory,
    ...project.files.flatMap((file) => ["--file", file]),
  ];
}

function labelArguments(labels: Labels): string[] {
  return Object.entries(labels).flatMap(([name, value]) => ["--label", `${name}=${value}`]);
}

function filterArguments(labels: Labels): string[] {
  return Object.entries(labels).flatMap(([name, value]) => ["--filter", `label=${name}=${value}`]);
}

function describe(labels: Labels): string {
  return Object.entries(labels)
    .map(([name, value]) => `${name}=${value}`)
    .join(", ");
}

/**
 * The service's own environment, without what would point compose at another project or file:
 * every command names its project and files itself.
 */
function runtimeEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !entry[0].startsWith("COMPOSE_"),
    ),
  );
}

async function appendingTo(file: string): Promise<WriteStream> {
  await mkdir(dirname(file), { recursive: true });
  return createWriteStream(file, { flags: "a" });
}

function notStarted(error: Error & { code?: string }): string {
  return error.code === "ENOENT"
    ? `The container runtime (${RUNTIME}) isn't installed here (docs/container-runtime.md).`
    : error.message;
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "");
}

/** The runtime's "2026-11-08 12:34:56 +0000 UTC". */
function dateOf(createdAt: string): Date {
  const [day, time, offset = "+0000"] = createdAt.split(" ");
  return new Date(`${day}T${time}${offset.slice(0, 3)}:${offset.slice(3)}`);
}

/** The last bytes up to a limit, decoded at the end. */
class BoundedText {
  private chunks: Buffer[] = [];
  private bytes = 0;

  constructor(private readonly limitBytes: number) {}

  add(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.bytes += chunk.length;
    while (this.bytes - (this.chunks[0]?.length ?? 0) >= this.limitBytes) {
      this.bytes -= this.chunks.shift()?.length ?? 0;
    }
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}
