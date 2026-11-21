import type { Readable, Writable } from "node:stream";
import type { Labels } from "../domain/run-environment.js";

/** An image to build, its output streamed to a file as it builds. */
export interface ImageBuild {
  readonly image: string;
  /** The build context, an absolute path. */
  readonly context: string;
  /** Relative to the context. */
  readonly dockerfile: string;
  readonly args: Readonly<Record<string, string>>;
  /**
   * Values the build's `RUN --mount=type=secret` lines read, by id: given to the runtime from its
   * CLI's environment, so they are in no command line, image layer or build argument.
   */
  readonly secrets: Readonly<Record<string, string>>;
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
  /**
   * Set in the compose CLI's environment for every command naming the project's files, which
   * read them as `${NAME}`: a Hosted Test instance's variables by their carriers (`carrierOf`), so
   * no value is ever in a compose file or a command line.
   */
  readonly variables?: Readonly<Record<string, string>>;
}

/** How a compose project is taken down. */
export interface Removal {
  /** Also removes the images compose built for its services, which no other project uses. */
  readonly builtImages?: boolean;
}

/**
 * Hides the Project's Secret variables in output as it streams to a file: Projects' `OutputMask`,
 * as Run environments needs it.
 */
export interface StreamedOutputMask {
  chunks(): { next(chunk: Uint8Array): Uint8Array; end(): Uint8Array };
}

/** A command line run in one of a compose project's services. */
export interface Execution {
  readonly service: string;
  readonly user?: string;
  /** A POSIX shell script, run by `/bin/sh -c`. */
  readonly script: string;
  /**
   * Given to the script as `$1`, `$2` and on, one by one, never read by the shell: an entry point's
   * command, which the script runs with `exec "$@"`.
   */
  readonly arguments?: readonly string[];
  /**
   * The variables the script runs with, set over the service's own. Given to the runtime by name,
   * their values in its CLI's environment, so no value is ever in a command line.
   */
  readonly variables: Readonly<Record<string, string>>;
  /** Masks the output on its way to the file. */
  readonly mask: StreamedOutputMask;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/**
 * A program run in a running service with its standard input and output The Office's own, as the
 * Office device helper is (spec §2.13, "The relay"): never through a shell, never with variables.
 */
export interface Attachment {
  readonly service: string;
  readonly user?: string;
  /** The program and its arguments, as they are. */
  readonly arguments: readonly string[];
  /** Where its standard error is appended as it comes. */
  readonly errorFile: string;
}

/** An attached program while it runs. */
export interface AttachedProcess {
  /** Its standard input; a write after it ended is dropped, as `ended` tells. */
  readonly stdin: Writable;
  readonly stdout: Readable;
  /** Resolves once it ended, never rejects: `endedBy: "stop"` after `stop()`. */
  readonly ended: Promise<ExecutionEnd>;
  /**
   * Ends its standard input, which a program reading it to its end takes as the end, then the
   * runtime's command. Never restarts the service, as a stopped check does.
   */
  stop(): void;
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

  /** Builds the image; `mask`, when given, hides values in its output on the way to the file. */
  abstract buildImage(
    build: ImageBuild,
    outputFile: string,
    mask?: StreamedOutputMask,
  ): Promise<void>;

  /** Brings the compose project up, building nothing for its checks' service, and waits for it. */
  abstract up(
    project: ComposeProject,
    outputFile: string,
    mask?: StreamedOutputMask,
  ): Promise<void>;

  /** Stops its containers, keeping them and their data. */
  abstract stop(projectName: string): Promise<void>;

  /** Runs the script in a running service, its stdout and stderr streamed to the file. */
  abstract exec(
    project: ComposeProject,
    execution: Execution,
    outputFile: string,
  ): Promise<ExecutionEnd>;

  /** Starts the program in a running service, its standard input and output piped to The Office. */
  abstract attach(project: ComposeProject, attachment: Attachment): Promise<AttachedProcess>;

  /** Takes the compose project down with its volumes and orphans. */
  abstract down(projectName: string, removal?: Removal): Promise<void>;

  /** The port on 127.0.0.1 the runtime published for the service's `containerPort`. */
  abstract publishedPort(
    project: ComposeProject,
    service: string,
    containerPort: number,
  ): Promise<number>;

  /**
   * Streams the logs of the service, or of every service when none is named, to the file as they
   * come, masked, from the start; resolves once following ends: the service ended (every one, when
   * none is named), the project was taken down, or `signal` aborted. It never throws for a
   * command that fails; it ends.
   */
  abstract followLogs(
    project: ComposeProject,
    service: string | undefined,
    outputFile: string,
    mask: StreamedOutputMask,
    signal: AbortSignal,
  ): Promise<void>;

  /** Makes the named volume with the labels; one that exists already stays as it is. */
  abstract createVolume(name: string, labels: Labels): Promise<void>;

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
