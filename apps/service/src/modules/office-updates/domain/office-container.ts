/** The Docker Compose project a container belongs to, as the labels Compose sets on it say. */
export interface ComposeProject {
  readonly project: string;
  readonly service: string;
  /** The compose folder, as a path on the host. */
  readonly workingDirectory: string;
  readonly configFiles: readonly string[];
  readonly environmentFiles: readonly string[];
}

/** A folder of the host mounted into the container. */
export interface ContainerMount {
  readonly source: string;
  readonly destination: string;
}

/** The container The Office's service runs in, as Docker sees it. */
export interface RunningOfficeContainer {
  readonly id: string;
  /** The image as the container was created from it, such as `ghcr.io/owner/the-office:1.3.0`. */
  readonly image: string;
  /** The image's id, which the Office updater runs so it is the same version's code. */
  readonly imageId: string;
  /** Undefined when Docker Compose didn't start the container. */
  readonly compose: ComposeProject | undefined;
  readonly mounts: readonly ContainerMount[];
  /** Docker's restart policy's name, such as `unless-stopped`; `no` when it has none. */
  readonly restartPolicy: string;
}

/** What reading the container found: Docker unreachable, with why, or the container. */
export type OfficeContainerRead =
  | { readonly reachable: false; readonly problem: string }
  | { readonly reachable: true; readonly container: RunningOfficeContainer };

/** The image's repository, without its tag or digest: `ghcr.io/owner/the-office`. */
export function imageRepository(image: string): string {
  const withoutDigest = image.split("@")[0] ?? image;
  const lastSlash = withoutDigest.lastIndexOf("/");
  const lastColon = withoutDigest.lastIndexOf(":");
  return lastColon > lastSlash ? withoutDigest.slice(0, lastColon) : withoutDigest;
}

/** The compose files outside the compose folder, which the Office updater can't reach. */
export function composeFilesOutside({
  workingDirectory,
  configFiles,
  environmentFiles,
}: ComposeProject): string[] {
  const folder = workingDirectory.endsWith("/") ? workingDirectory : `${workingDirectory}/`;
  return [...configFiles, ...environmentFiles].filter((file) => !file.startsWith(folder));
}
