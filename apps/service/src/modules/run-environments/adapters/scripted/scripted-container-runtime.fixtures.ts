import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Labels } from "../../domain/run-environment.js";
import {
  ContainerRuntime,
  ContainerRuntimeFailed,
  type ComposeProject,
  type Execution,
  type ExecutionEnd,
  type ImageBuild,
  type LabelledImage,
  type LabelledResource,
  type StreamedOutputMask,
} from "../../ports/container-runtime.js";

/** Masks nothing, for a check whose Project has no Secret variables. */
export const NO_MASK: StreamedOutputMask = {
  chunks: () => ({ next: (chunk) => chunk, end: () => new Uint8Array() }),
};

/** What a scripted check does: its output, its exit code, and when it ends. */
export type ScriptedExecution = (
  execution: Execution,
) => Promise<{ readonly output?: string; readonly exitCode: number }>;

/**
 * A container runtime in memory, for tests: it keeps the images built, each compose project's
 * state and the resources it made with their labels, records every step, and runs a check as
 * `onExec` says, by default printing nothing and exiting 0.
 */
export class ScriptedContainerRuntime extends ContainerRuntime {
  readonly images = new Map<string, Date>();
  readonly projects = new Map<string, { project: ComposeProject; state: "running" | "stopped" }>();
  readonly resources: LabelledResource[] = [];
  readonly builds: ImageBuild[] = [];
  readonly steps: string[] = [];
  onExec: ScriptedExecution = () => Promise.resolve({ exitCode: 0 });
  /** The steps that fail next, by name ("up", "build", "exec"), each once. */
  readonly failing = new Set<"up" | "build" | "exec">();
  private clock = 0;

  imageExists(image: string): Promise<boolean> {
    return Promise.resolve(this.images.has(image));
  }

  async buildImage(build: ImageBuild, outputFile: string): Promise<void> {
    this.steps.push(`build ${build.image}`);
    this.failOnce("build", `The image ${build.image} couldn't be built.`);
    this.builds.push(build);
    await write(outputFile, `built ${build.image}\n`);
    this.images.set(build.image, new Date(++this.clock * 1000));
  }

  async up(project: ComposeProject, outputFile: string): Promise<void> {
    this.steps.push(`up ${project.name}`);
    this.failOnce("up", `The compose project ${project.name} couldn't start.`);
    await write(outputFile, `up ${project.name}\n`);
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
    const { output, exitCode } = await this.onExec(execution);
    // As the runtime streams it: masked, chunk by chunk.
    const masked = execution.mask.chunks();
    const bytes = Buffer.from(output ?? "", "utf8");
    await write(
      outputFile,
      Buffer.concat([masked.next(bytes), masked.end()].map((chunk) => Buffer.from(chunk))),
    );
    return { exitCode };
  }

  down(projectName: string): Promise<void> {
    this.steps.push(`down ${projectName}`);
    this.projects.delete(projectName);
    this.removeWhere((resource) => resource.id.startsWith(`${projectName}_`));
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

  /** A resource left from another run of The Office, as the startup sweep finds it. */
  leave(resource: LabelledResource): void {
    this.resources.push(resource);
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
  const [, instance = "", ...task] = project.name.split("-");
  return { "office.managed": "true", "office.instance": instance, "office.task": task.join("-") };
}

function carries(have: Labels, wanted: Labels): boolean {
  return Object.entries(wanted).every(([name, value]) => have[name] === value);
}

async function write(file: string, text: string | Buffer): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, text);
}
