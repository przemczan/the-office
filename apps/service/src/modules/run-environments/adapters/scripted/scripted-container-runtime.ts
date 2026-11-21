import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
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
  type Removal,
  type StreamedOutputMask,
} from "../../ports/container-runtime.js";

/** Masks nothing, for a check whose Project has no Secret variables. */
export const NO_MASK: StreamedOutputMask = {
  chunks: () => ({ next: (chunk) => chunk, end: () => new Uint8Array() }),
};

/** What a scripted check does: its output, its exit code, and when and how it ends. */
export type ScriptedExecution = (execution: Execution) => Promise<{
  readonly output?: string;
  readonly exitCode: number | undefined;
  readonly endedBy?: ExecutionEnd["endedBy"];
}>;

/** What an execution held running ends with. */
interface ExecutionResult {
  readonly output?: string;
  readonly exitCode: number | undefined;
}

/** A `followLogs` going on: where it writes, and how it ends. */
interface Follower {
  readonly projectName: string;
  readonly service: string | undefined;
  readonly outputFile: string;
  readonly mask: StreamedOutputMask;
  readonly end: () => void;
}

/** The exit code `compose exec` ends with when its container is killed under it. */
const KILLED_EXIT_CODE = 137;

/**
 * A container runtime in memory, for tests and the end-to-end service (`src/e2e.ts`, which binds it
 * in place of the compose CLI, so it is built, not a fixture): it keeps the images built, each compose project's
 * state and the resources it made with their labels, records every step, and runs a check as
 * `onExec` says, by default printing nothing and exiting 0. For a Hosted Test instance it
 * publishes every port on `hostPort`, answers there while `answering`, keeps execs running after
 * `keepExecsRunning` until `endExecs` or the project is taken down, and writes `emitLogs`' text to
 * the project's log followers.
 */
export class ScriptedContainerRuntime extends ContainerRuntime {
  readonly images = new Map<string, Date>();
  readonly projects = new Map<string, { project: ComposeProject; state: "running" | "stopped" }>();
  readonly resources: LabelledResource[] = [];
  readonly builds: ImageBuild[] = [];
  readonly steps: string[] = [];
  /** Every project brought up, as `up` was given it, its CLI variables among them. */
  readonly upped: ComposeProject[] = [];
  /** Every execution run, as it was given. */
  readonly executions: Execution[] = [];
  onExec: ScriptedExecution = () => Promise.resolve({ exitCode: 0 });
  /** The port `publishedPort` answers for every service and container port. */
  hostPort = 49_153;
  /** Whether the app answers on `hostPort`, as `answers` tells the readiness check. */
  answering = true;
  private holdingExecs = false;
  private readonly heldExecs: {
    readonly projectName: string;
    readonly end: (result: ExecutionResult) => void;
  }[] = [];
  private readonly followers: Follower[] = [];
  /** The steps that fail next, by name ("up", "build", "exec"), each once. */
  readonly failing = new Set<"up" | "build" | "exec">();
  private clock = 0;

  imageExists(image: string): Promise<boolean> {
    return Promise.resolve(this.images.has(image));
  }

  async buildImage(
    build: ImageBuild,
    outputFile: string,
    mask?: StreamedOutputMask,
  ): Promise<void> {
    this.steps.push(`build ${build.image}`);
    this.failOnce("build", `The image ${build.image} couldn't be built.`);
    this.builds.push(build);
    await write(outputFile, masked(mask, `built ${build.image}\n`));
    this.images.set(build.image, new Date(++this.clock * 1000));
  }

  async up(project: ComposeProject, outputFile: string, mask?: StreamedOutputMask): Promise<void> {
    this.steps.push(`up ${project.name}`);
    this.failOnce("up", `The compose project ${project.name} couldn't start.`);
    this.upped.push(project);
    await write(outputFile, masked(mask, `up ${project.name}\n`));
    if (!this.projects.has(project.name)) this.resources.push(...resourcesOf(project));
    this.projects.set(project.name, { project, state: "running" });
  }

  stop(projectName: string): Promise<void> {
    this.steps.push(`stop ${projectName}`);
    const known = this.projects.get(projectName);
    if (known) known.state = "stopped";
    return Promise.resolve();
  }

  async exec(
    project: ComposeProject,
    execution: Execution,
    outputFile: string,
  ): Promise<ExecutionEnd> {
    this.steps.push(`exec ${project.name}`);
    this.failOnce("exec", `The service ${execution.service} isn't running.`);
    if (this.projects.get(project.name)?.state !== "running") {
      throw new ContainerRuntimeFailed(`The compose project ${project.name} isn't running.`);
    }
    this.executions.push(execution);
    const { output, exitCode, endedBy } = this.holdingExecs
      ? await new Promise<ExecutionResult & { endedBy?: undefined }>((end) =>
          this.heldExecs.push({ projectName: project.name, end }),
        )
      : await this.onExec(execution);
    // As the runtime streams it: masked, chunk by chunk.
    await write(outputFile, masked(execution.mask, output ?? ""));
    return { exitCode, ...(endedBy === undefined ? {} : { endedBy }) };
  }

  down(projectName: string, removal: Removal = {}): Promise<void> {
    this.steps.push(
      `down ${projectName}${removal.builtImages === true ? " with built images" : ""}`,
    );
    this.projects.delete(projectName);
    // Its containers are killed: what runs in them ends, and their logs with them.
    this.endHeld(projectName, { exitCode: KILLED_EXIT_CODE });
    for (const follower of this.followers.filter((each) => each.projectName === projectName)) {
      follower.end();
    }
    this.removeWhere((resource) => resource.id.startsWith(`${projectName}_`));
    return Promise.resolve();
  }

  createVolume(name: string, labels: Labels): Promise<void> {
    this.steps.push(`volume ${name}`);
    if (!this.resources.some((resource) => resource.kind === "volume" && resource.id === name)) {
      this.resources.push({ kind: "volume", id: name, labels });
    }
    return Promise.resolve();
  }

  listByLabel(labels: Labels): Promise<readonly LabelledResource[]> {
    return Promise.resolve(this.resources.filter((resource) => carries(resource.labels, labels)));
  }

  removeByLabel(labels: Labels): Promise<void> {
    this.steps.push(`remove ${JSON.stringify(labels)}`);
    this.removeWhere((resource) => carries(resource.labels, labels));
    return Promise.resolve();
  }

  listImages(): Promise<readonly LabelledImage[]> {
    return Promise.resolve([...this.images].map(([name, createdAt]) => ({ name, createdAt })));
  }

  removeImage(image: string): Promise<void> {
    this.steps.push(`remove image ${image}`);
    this.images.delete(image);
    return Promise.resolve();
  }

  publishedPort(project: ComposeProject, service: string, containerPort: number): Promise<number> {
    this.steps.push(`port ${project.name} ${service} ${containerPort}`);
    if (this.projects.get(project.name)?.state !== "running") {
      return Promise.reject(
        new ContainerRuntimeFailed(`The compose project ${project.name} isn't running.`),
      );
    }
    return Promise.resolve(this.hostPort);
  }

  followLogs(
    project: ComposeProject,
    service: string | undefined,
    outputFile: string,
    mask: StreamedOutputMask,
    signal: AbortSignal,
  ): Promise<void> {
    this.steps.push(`logs ${project.name}${service === undefined ? "" : ` ${service}`}`);
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const follower: Follower = {
        projectName: project.name,
        service,
        outputFile,
        mask,
        end: () => {
          const index = this.followers.indexOf(follower);
          if (index >= 0) this.followers.splice(index, 1);
          signal.removeEventListener("abort", follower.end);
          resolve();
        },
      };
      this.followers.push(follower);
      signal.addEventListener("abort", follower.end, { once: true });
    });
  }

  /** Whether the app answers on the port, as a TCP connect to 127.0.0.1 would. */
  answers(port: number): Promise<boolean> {
    return Promise.resolve(this.answering && port === this.hostPort);
  }

  /** Writes the text, masked, to every log follower of the project, as its services print it. */
  async emitLogs(projectName: string, text: string): Promise<void> {
    for (const follower of this.followers.filter((each) => each.projectName === projectName)) {
      await write(follower.outputFile, masked(follower.mask, text));
    }
  }

  /**
   * Ends the log following of the project's service, or of the whole project when none is named,
   * as when the service ends on its own.
   */
  endService(projectName: string, service?: string): void {
    for (const follower of this.followers.filter(
      (each) =>
        each.projectName === projectName && (service === undefined || each.service === service),
    )) {
      follower.end();
    }
  }

  /** From now on an exec keeps running, as an entry point does, until `endExecs` or `down`. */
  keepExecsRunning(): void {
    this.holdingExecs = true;
  }

  /** Ends every exec held running in the project, as an entry point ending on its own. */
  endExecs(projectName: string, exitCode: number, output?: string): void {
    this.endHeld(projectName, { exitCode, ...(output === undefined ? {} : { output }) });
  }

  /** How many execs are held running in the project. */
  runningExecs(projectName: string): number {
    return this.heldExecs.filter((held) => held.projectName === projectName).length;
  }

  /** A resource left from another run of The Office, as the startup sweep finds it. */
  leave(resource: LabelledResource): void {
    this.resources.push(resource);
  }

  private endHeld(projectName: string, result: ExecutionResult): void {
    for (let index = this.heldExecs.length - 1; index >= 0; index--) {
      const held = this.heldExecs[index];
      if (held?.projectName !== projectName) continue;
      this.heldExecs.splice(index, 1);
      held.end(result);
    }
  }

  private failOnce(step: "up" | "build" | "exec", message: string): void {
    if (this.failing.delete(step)) throw new ContainerRuntimeFailed(message);
  }

  private removeWhere(matches: (resource: LabelledResource) => boolean): void {
    for (let index = this.resources.length - 1; index >= 0; index--) {
      const resource = this.resources[index];
      if (resource !== undefined && matches(resource)) this.resources.splice(index, 1);
    }
  }
}

/** A compose project's network, and a container per service, labelled as the override says. */
function resourcesOf(project: ComposeProject): LabelledResource[] {
  return [
    { kind: "network", id: `${project.name}_default`, labels: labelsOf(project) },
    ...project.services.map((service) => ({
      kind: "container" as const,
      id: `${project.name}_${service}`,
      labels: labelsOf(project),
    })),
  ];
}

/** The labels The Office put on the project, read back from its name's parts. */
function labelsOf(project: ComposeProject): Labels {
  const hosted = /^office-([^-]+)-test-(.+)$/.exec(project.name);
  if (hosted !== null) {
    const [, instance = "", testInstance = ""] = hosted;
    return {
      "office.managed": "true",
      "office.instance": instance,
      [LABEL.testInstance]: testInstance,
    };
  }
  const [, instance = "", ...task] = project.name.split("-");
  return { "office.managed": "true", "office.instance": instance, "office.task": task.join("-") };
}

function carries(have: Labels, wanted: Labels): boolean {
  return Object.entries(wanted).every(([name, value]) => have[name] === value);
}

/** The text as the runtime streams it to a file: masked, chunk by chunk. */
function masked(mask: StreamedOutputMask | undefined, text: string): Buffer {
  const bytes = Buffer.from(text, "utf8");
  if (mask === undefined) return bytes;
  const chunks = mask.chunks();
  return Buffer.concat([chunks.next(bytes), chunks.end()].map((chunk) => Buffer.from(chunk)));
}

async function write(file: string, text: string | Buffer): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, text);
}
