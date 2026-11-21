import { Injectable } from "@nestjs/common";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Transform, type Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { startProgram } from "../../../../platform/os/program.js";
import { LABEL, type Labels } from "../../domain/run-environment.js";
import {
  ContainerRuntime,
  ContainerRuntimeFailed,
  type AttachedProcess,
  type Attachment,
  type ComposeProject,
  type Execution,
  type ExecutionEnd,
  type ImageBuild,
  type LabelledImage,
  type LabelledResource,
  type Removal,
  type ResourceKind,
  type StreamedOutputMask,
} from "../../ports/container-runtime.js";

/** The container runtime's CLI, Docker Engine with its Compose plugin (docs/container-runtime.md). */
const RUNTIME = "docker";

/** How long a short command, such as a listing, may take. */
const SHORT_TIMEOUT_MS = 2 * 60 * 1000;
/** How long building an image or starting a compose project may take. */
const LONG_TIMEOUT_MS = 60 * 60 * 1000;
/** How long `up` waits for the services to be running, or healthy where they have a healthcheck. */
const UP_WAIT_SECONDS = 600;
/** The longest a timer runs: following a Hosted Test instance's logs runs until it ends. */
const LONGEST_TIMEOUT_MS = 2 ** 31 - 1;
/** How long an attached program has, after its input ends, before its CLI is ended. */
const ATTACHED_STOP_GRACE_MS = 2000;
/** The end of a failing command's error output kept for its message. */
const ERROR_TAIL_BYTES = 4096;
/** The most a listing's output may hold. */
const LISTING_LIMIT_BYTES = 8 * 1024 * 1024;

const LISTED_LABELS = Object.values(LABEL);

interface Invocation {
  readonly arguments: readonly string[];
  /** Set over the service's own environment for the CLI, which reads them by name. */
  readonly variables?: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  /** Streams stdout and stderr there; else stdout is kept, for a listing. */
  readonly outputFile?: string;
  /** Masks what is streamed to `outputFile`. */
  readonly mask?: StreamedOutputMask;
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

  async buildImage(
    build: ImageBuild,
    outputFile: string,
    mask?: StreamedOutputMask,
  ): Promise<void> {
    await this.required(`The image ${build.image} couldn't be built`, {
      arguments: buildArguments(build),
      variables: build.secrets,
      timeoutMs: LONG_TIMEOUT_MS,
      outputFile,
      ...(mask === undefined ? {} : { mask }),
    });
  }

  async up(project: ComposeProject, outputFile: string, mask?: StreamedOutputMask): Promise<void> {
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
      ...variablesOf(project),
      timeoutMs: LONG_TIMEOUT_MS,
      outputFile,
      ...(mask === undefined ? {} : { mask }),
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
      arguments: execArguments(project, execution),
      variables: { ...project.variables, ...execution.variables },
      timeoutMs: execution.timeoutMs,
      outputFile,
      mask: execution.mask,
      workingFolder: project.projectDirectory,
      ...(execution.signal === undefined ? {} : { signal: execution.signal }),
    });
    if (ended.endedBy !== undefined) {
      // Ending the CLI leaves the command running in the container: restarting the service ends it.
      await this.required(`The service ${execution.service} couldn't be restarted`, {
        arguments: [...composeArguments(project), "restart", execution.service],
        ...variablesOf(project),
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

  async attach(project: ComposeProject, attachment: Attachment): Promise<AttachedProcess> {
    await mkdir(dirname(attachment.errorFile), { recursive: true });
    const errors = createWriteStream(attachment.errorFile, { flags: "a" });
    const { processTrees } = this.operatingSystem;
    const child = startProgram(
      {
        command: RUNTIME,
        arguments: attachArguments(project, attachment),
        workingFolder: project.projectDirectory,
        environment: { ...runtimeEnvironment(), ...project.variables },
      },
      processTrees,
    );
    child.stderr.pipe(errors);
    // A write after the program ended fails with EPIPE, which would otherwise end the service.
    child.stdin.on("error", () => undefined);
    errors.on("error", () => undefined);

    let stopped = false;
    let closed = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const ended = new Promise<ExecutionEnd>((resolve) => {
      child.once("error", (error) => {
        closed = true;
        errors.end(`${notStarted(error)}\n`);
        resolve({ exitCode: undefined });
      });
      child.once("close", (code) => {
        closed = true;
        clearTimeout(killTimer);
        resolve(
          stopped ? { exitCode: undefined, endedBy: "stop" } : { exitCode: code ?? undefined },
        );
      });
    });
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      ended,
      stop: () => {
        if (stopped || closed) return;
        stopped = true;
        child.stdin.end();
        // The end of its input ends the program in the container; the CLI is ended after a grace,
        // and nothing restarts the service, which a device's program shares with the checks.
        killTimer = setTimeout(() => {
          if (child.pid !== undefined) void processTrees.end(child.pid);
        }, ATTACHED_STOP_GRACE_MS);
        killTimer.unref();
      },
    };
  }

  async userIdsOf(project: ComposeProject, service: string, user?: string): Promise<string> {
    const what = `The user's ids in the service ${service} couldn't be read`;
    const { stdout } = await this.required(what, {
      arguments: userIdsArguments(project, service, user),
      ...variablesOf(project),
      timeoutMs: SHORT_TIMEOUT_MS,
      workingFolder: project.projectDirectory,
    });
    const ids = userIdsFrom(stdout);
    if (ids === undefined) throw new ContainerRuntimeFailed(`${what}. It printed ${stdout.trim()}`);
    return ids;
  }

  async down(projectName: string, removal: Removal = {}): Promise<void> {
    await this.required(`The compose project ${projectName} couldn't be removed`, {
      arguments: [
        "compose",
        "--project-name",
        projectName,
        "down",
        "--volumes",
        "--remove-orphans",
        ...(removal.builtImages === true ? ["--rmi", "local"] : []),
        "--timeout",
        "10",
      ],
      timeoutMs: SHORT_TIMEOUT_MS,
    });
  }

  async publishedPort(
    project: ComposeProject,
    service: string,
    containerPort: number,
  ): Promise<number> {
    const what = `The port ${containerPort} of the service ${service} isn't published`;
    const { stdout } = await this.required(what, {
      arguments: [...composeArguments(project), "port", service, String(containerPort)],
      ...variablesOf(project),
      timeoutMs: SHORT_TIMEOUT_MS,
      workingFolder: project.projectDirectory,
    });
    const port = publishedPortOf(stdout);
    if (port === undefined) throw new ContainerRuntimeFailed(`${what}.`);
    return port;
  }

  async followLogs(
    project: ComposeProject,
    service: string | undefined,
    outputFile: string,
    mask: StreamedOutputMask,
    signal: AbortSignal,
  ): Promise<void> {
    await this.invoke({
      arguments: [
        ...composeArguments(project),
        "logs",
        "--follow",
        "--no-color",
        ...(service === undefined ? [] : [service]),
      ],
      ...variablesOf(project),
      timeoutMs: LONGEST_TIMEOUT_MS,
      outputFile,
      mask,
      signal,
      workingFolder: project.projectDirectory,
    });
  }

  async createVolume(name: string, labels: Labels): Promise<void> {
    // `volume create` answers an existing volume's name as it is, so a second build reuses it.
    await this.required(`The volume ${name} couldn't be made`, {
      arguments: [
        "volume",
        "create",
        ...Object.entries(labels).flatMap(([label, value]) => ["--label", `${label}=${value}`]),
        name,
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
    const output = invocation.outputFile
      ? await appendingTo(invocation.outputFile, invocation.mask)
      : undefined;
    const { processTrees } = this.operatingSystem;
    const child = startProgram(
      {
        command: RUNTIME,
        arguments: invocation.arguments,
        workingFolder,
        environment: { ...runtimeEnvironment(), ...invocation.variables },
      },
      processTrees,
    );
    const stdout = new BoundedText(LISTING_LIMIT_BYTES);
    const errorTail = new BoundedText(ERROR_TAIL_BYTES);
    let outputFailed: Error | undefined;
    if (output) {
      // Piped, so a slow disk holds the command back instead of its output filling memory.
      child.stdout.pipe(output.input, { end: false });
      child.stderr.pipe(output.input, { end: false });
      output.file.on("error", (error) => {
        outputFailed ??= error;
        if (child.pid !== undefined) void processTrees.end(child.pid);
      });
    } else {
      child.stdout.on("data", (chunk: Buffer) => stdout.add(chunk));
    }
    child.stderr.on("data", (chunk: Buffer) => errorTail.add(chunk));

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
    if (output && outputFailed === undefined) {
      output.input.end();
      await finished(output.file).catch((error: unknown) => {
        outputFailed ??= error instanceof Error ? error : new Error(String(error));
      });
    }
    if (outputFailed !== undefined) {
      throw new ContainerRuntimeFailed(
        `The output couldn't be written to ${invocation.outputFile}. ${outputFailed.message}`,
      );
    }
    return {
      exitCode: endedBy === undefined ? exitCode : undefined,
      ...(endedBy === undefined ? {} : { endedBy }),
      stdout: stdout.text(),
      errorTail: errorTail.text().trim(),
    };
  }
}

/**
 * `compose exec` of the script, its variables given by name alone (`--env NAME`), which the CLI
 * takes from its own environment: no value is ever in the command line.
 */
export function execArguments(project: ComposeProject, execution: Execution): string[] {
  return [
    ...composeArguments(project),
    "exec",
    "--no-TTY",
    ...(execution.user === undefined ? [] : ["--user", execution.user]),
    ...Object.keys(execution.variables).flatMap((name) => ["--env", name]),
    execution.service,
    "/bin/sh",
    "-c",
    execution.script,
    // The script's $0, then its arguments one by one.
    ...(execution.arguments === undefined ? [] : ["office-entry-point", ...execution.arguments]),
  ];
}

/**
 * `compose exec --interactive` of the program as it is, its standard input kept open and no TTY,
 * so its bytes pass unchanged both ways.
 */
export function attachArguments(project: ComposeProject, attachment: Attachment): string[] {
  return [
    ...composeArguments(project),
    "exec",
    "--interactive",
    "--no-TTY",
    ...(attachment.user === undefined ? [] : ["--user", attachment.user]),
    attachment.service,
    ...attachment.arguments,
  ];
}

/** `compose exec` of `id -u` and `id -g` as the user, printing `<uid>:<gid>`. */
export function userIdsArguments(
  project: ComposeProject,
  service: string,
  user: string | undefined,
): string[] {
  return [
    ...composeArguments(project),
    "exec",
    "--no-TTY",
    ...(user === undefined ? [] : ["--user", user]),
    service,
    "/bin/sh",
    "-c",
    'printf "%s:%s\\n" "$(id -u)" "$(id -g)"',
  ];
}

/** `<uid>:<gid>` from what `userIdsArguments`' command printed; none unless it is that. */
export function userIdsFrom(stdout: string): string | undefined {
  const ids = stdout.trim();
  return /^\d+:\d+$/.test(ids) ? ids : undefined;
}

/** The host port in `compose port`'s `127.0.0.1:49153`; none when nothing is published. */
export function publishedPortOf(stdout: string): number | undefined {
  const line = lines(stdout)[0]?.trim() ?? "";
  const port = Number(line.slice(line.lastIndexOf(":") + 1));
  return line.includes(":") && Number.isInteger(port) && port > 0 ? port : undefined;
}

/** `build` of the image, each secret given from the CLI's environment by its id. */
export function buildArguments(build: ImageBuild): string[] {
  return [
    "build",
    "--progress",
    "plain",
    "--tag",
    build.image,
    "--file",
    join(build.context, build.dockerfile),
    ...labelArguments(build.labels),
    ...Object.entries(build.args).flatMap(([name, value]) => ["--build-arg", `${name}=${value}`]),
    ...Object.keys(build.secrets).flatMap((id) => ["--secret", `id=${id},env=${id}`]),
    ...(build.target === undefined ? [] : ["--target", build.target]),
    build.context,
  ];
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

function variablesOf(project: ComposeProject): {
  readonly variables?: Readonly<Record<string, string>>;
} {
  return project.variables === undefined ? {} : { variables: project.variables };
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

/** Where a command's output goes: `input`, masked on its way to `file`. */
interface OutputStream {
  readonly input: Writable;
  readonly file: WriteStream;
}

async function appendingTo(
  file: string,
  mask: StreamedOutputMask | undefined,
): Promise<OutputStream> {
  await mkdir(dirname(file), { recursive: true });
  const stream = createWriteStream(file, { flags: "a" });
  if (mask === undefined) return { input: stream, file: stream };
  const masked = mask.chunks();
  const input = new Transform({
    transform: (chunk: Buffer, _encoding, done) => done(null, masked.next(chunk)),
    flush: (done) => done(null, masked.end()),
  });
  input.pipe(stream);
  return { input, file: stream };
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
