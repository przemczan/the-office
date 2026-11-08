import type { Labels } from "../domain/run-environment.js";

/** An image to build, its output streamed to a file as it builds. */
export interface ImageBuild {
  readonly image: string;
  /** The build context, an absolute path. */
  readonly context: string;
  /** Relative to the context. */
  readonly dockerfile: string;
  readonly args: Readonly<Record<string, string>>;
  readonly target?: string;
  readonly labels: Labels;
}

/** A Task's compose project: its name, and the compose files it is made of. */
export interface ComposeProject {
  readonly name: string;
  /** Absolute paths, in the order compose merges them; the Office's override last. */
  readonly files: readonly string[];
  /** The folder compose resolves the files' relative paths against. */
  readonly projectDirectory: string;
  /** The services to start. */
  readonly services: readonly string[];
}

/** A command line run in one of a compose project's services. */
export interface Execution {
  readonly service: string;
  readonly user?: string;
  /** A POSIX shell script, run by `/bin/sh -c`. */
  readonly script: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/** How an execution ended; an exit code only when the command ended by itself. */
export interface ExecutionEnd {
  readonly exitCode: number | undefined;
  readonly endedBy?: "timeout" | "stop";
}

export type ResourceKind = "container" | "network" | "volume";

/** A container, network or volume, with its labels. */
export interface LabelledResource {
  readonly kind: ResourceKind;
  readonly id: string;
  readonly labels: Labels;
}

export interface LabelledImage {
  /** `repository:tag`. */
  readonly name: string;
  readonly createdAt: Date;
}

/**
 * A container runtime with compose (spec §5.2, docs/container-runtime.md). Output that can be long
 * goes to the file named, appended as it comes, never held whole in memory. A step that fails
 * throws `ContainerRuntimeFailed`.
 */
export abstract class ContainerRuntime {
  abstract imageExists(image: string): Promise<boolean>;

  abstract buildImage(build: ImageBuild, outputFile: string): Promise<void>;

  /** Brings the compose project up, building nothing for its checks' service, and waits for it. */
  abstract up(project: ComposeProject, outputFile: string): Promise<void>;

  /** Stops its containers, keeping them and their data. */
  abstract stop(projectName: string): Promise<void>;

  /** Runs the script in a running service, its stdout and stderr streamed to the file. */
  abstract exec(
    project: ComposeProject,
    execution: Execution,
    outputFile: string,
  ): Promise<ExecutionEnd>;

  /** Takes the compose project down with its volumes and orphans. */
  abstract down(projectName: string): Promise<void>;

  /** The containers, networks and volumes carrying every one of the labels. */
  abstract listByLabel(labels: Labels): Promise<readonly LabelledResource[]>;

  /** Removes the containers, networks and volumes carrying every one of the labels. */
  abstract removeByLabel(labels: Labels): Promise<void>;

  abstract listImages(labels: Labels): Promise<readonly LabelledImage[]>;

  abstract removeImage(image: string): Promise<void>;
}

/** A container runtime command that failed, with why in the UI's words. */
export class ContainerRuntimeFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContainerRuntimeFailed";
  }
}
