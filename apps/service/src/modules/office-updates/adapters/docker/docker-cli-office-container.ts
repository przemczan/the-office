import { execFile } from "node:child_process";
import { access, constants, readFile } from "node:fs/promises";
import { posix } from "node:path";
import { z } from "zod";
import type {
  ComposeProject,
  ContainerMount,
  OfficeContainerRead,
  RunningOfficeContainer,
} from "../../domain/office-container.js";
import {
  OfficeContainer,
  type StartedUpdater,
  type UpdaterRequest,
} from "../../ports/office-container.js";

export const DOCKER_SOCKET = "/var/run/docker.sock";
/** The label the Office updater's container carries, so it can be told apart from The Office's. */
export const UPDATER_LABEL = "org.the-office.updater=1";
/** The updater's entry in the image, where the Dockerfile unpacks the release. */
export const UPDATER_ENTRY = "/opt/the-office/tools/office-launcher/src/container-main.ts";

const DOCKER_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;

const COMPOSE_LABEL = "com.docker.compose";

const inspectSchema = z
  .array(
    z.object({
      Id: z.string().min(1),
      Image: z.string().min(1),
      Config: z.object({
        Image: z.string().min(1),
        Labels: z.record(z.string(), z.string()).nullable(),
      }),
      Mounts: z.array(z.object({ Source: z.string(), Destination: z.string() })).nullable(),
      HostConfig: z.object({ RestartPolicy: z.object({ Name: z.string() }).nullish() }).nullish(),
    }),
  )
  .length(1);

/**
 * The container's id from `/proc/self/mountinfo`, where Docker mounts its own files of the
 * container (resolv.conf, hostname, hosts) from a folder named by its id; undefined elsewhere.
 */
export function containerIdFrom(mountinfo: string): string | undefined {
  return /\/containers\/([0-9a-f]{64})\/(?:resolv\.conf|hostname|hosts)\s/.exec(mountinfo)?.[1];
}

/** The container as `docker inspect` gives it, with the Compose project its labels name. */
export function officeContainerFrom(inspected: unknown): RunningOfficeContainer {
  const [container] = inspectSchema.parse(inspected);
  if (!container) throw new Error("docker inspect gave no container.");
  return {
    id: container.Id,
    image: container.Config.Image,
    imageId: container.Image,
    compose: composeProjectFrom(container.Config.Labels ?? {}),
    mounts: (container.Mounts ?? []).map(({ Source, Destination }) => ({
      source: Source,
      destination: Destination,
    })),
    // Docker names no policy with an empty name.
    restartPolicy: container.HostConfig?.RestartPolicy?.Name || "no",
  };
}

/** The project from the labels Compose sets itself; undefined when one of them is missing. */
export function composeProjectFrom(
  labels: Readonly<Record<string, string>>,
): ComposeProject | undefined {
  const label = (name: string) => labels[`${COMPOSE_LABEL}.${name}`]?.trim() || undefined;
  const project = label("project");
  const service = label("service");
  const workingDirectory = label("project.working_dir");
  const configFiles = list(label("project.config_files"));
  if (!project || !service || !workingDirectory || configFiles.length === 0) return undefined;
  return {
    project,
    service,
    workingDirectory,
    configFiles,
    environmentFiles: list(label("project.environment_file")),
  };
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** The host's path of `path` in the container, through the mount holding it. */
export function hostPathOf(mounts: readonly ContainerMount[], path: string): string | undefined {
  const holding = mounts
    .filter(({ destination }) => path === destination || path.startsWith(`${destination}/`))
    .toSorted((a, b) => b.destination.length - a.destination.length)[0];
  return holding && posix.join(holding.source, path.slice(holding.destination.length));
}

/** `docker run`'s arguments for the Office updater of `container`. */
export function updaterRunArguments(
  container: RunningOfficeContainer,
  compose: ComposeProject,
  { updateFolder, officeDataDirectory }: UpdaterRequest,
): string[] {
  const dataOnHost = hostPathOf(container.mounts, officeDataDirectory);
  if (!dataOnHost) {
    throw new Error(
      `The Office data directory ${officeDataDirectory} isn't mounted from the host.`,
    );
  }
  const socketOnHost = hostPathOf(container.mounts, DOCKER_SOCKET) ?? DOCKER_SOCKET;
  return [
    "run",
    "--detach",
    "--rm",
    "--label",
    UPDATER_LABEL,
    "--user",
    "0:0",
    "--volume",
    `${socketOnHost}:${DOCKER_SOCKET}`,
    "--volume",
    `${compose.workingDirectory}:${compose.workingDirectory}`,
    "--volume",
    `${dataOnHost}:${officeDataDirectory}`,
    "--env",
    `OFFICE_UPDATE_FOLDER=${updateFolder}`,
    "--env",
    `OFFICE_CONTAINER=${container.id}`,
    "--entrypoint",
    "node",
    container.imageId,
    UPDATER_ENTRY,
  ];
}

/**
 * The service's container, read and driven with the docker CLI on PATH through Docker's socket,
 * which a Docker Compose install mounts into it.
 */
export class DockerCliOfficeContainer extends OfficeContainer {
  constructor(private readonly hostname: string | undefined = process.env["HOSTNAME"]) {
    super();
  }

  async read(): Promise<OfficeContainerRead> {
    try {
      await access(DOCKER_SOCKET, constants.R_OK | constants.W_OK);
    } catch (error) {
      return { reachable: false, problem: messageOf(error) };
    }
    try {
      return { reachable: true, container: await this.inspectOwn() };
    } catch (error) {
      return { reachable: false, problem: messageOf(error) };
    }
  }

  async startUpdater(request: UpdaterRequest): Promise<StartedUpdater> {
    const container = await this.inspectOwn();
    if (!container.compose) throw new Error("Docker Compose didn't start The Office's container.");
    const updater = (
      await docker(updaterRunArguments(container, container.compose, request))
    ).trim();
    const ended = docker(["wait", updater], 0).then(() => undefined);
    return { ended };
  }

  private async inspectOwn(): Promise<RunningOfficeContainer> {
    const id = containerIdFrom(await readFile("/proc/self/mountinfo", "utf8")) ?? this.hostname;
    if (!id) throw new Error("The Office's container doesn't know its own id.");
    return officeContainerFrom(JSON.parse(await docker(["inspect", id])));
  }
}

function docker(args: readonly string[], timeout = DOCKER_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      args,
      { timeout, maxBuffer: OUTPUT_LIMIT_BYTES, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`docker ${args[0]} failed: ${stderr.trim() || error.message}`));
        else resolve(stdout);
      },
    );
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
