import {
  composeFilesOutside,
  imageRepository,
  type OfficeContainerRead,
} from "./office-container.js";
import { tarballAssetsOf, tarballName, type PublishedRelease } from "./published-release.js";

/** What a check found that decides whether Update can go ahead. */
export interface CheckoutState {
  readonly localChanges: boolean;
  /** The checkout's upstream branch, such as `origin/main`; absent when it has none. */
  readonly upstream: string | undefined;
  /** Commits the checkout has that its upstream doesn't. */
  readonly ahead: number;
}

/** What decides whether a release install can update itself. */
export interface ReleaseState {
  /** Whether its launcher runs it from its releases folder (OFFICE_INSTALL=release). */
  readonly installed: boolean;
  /** The GitHub repository its stamp says it comes from, as `owner/name`. */
  readonly repository: string | undefined;
  /** The newest release the last check found; undefined before a check or when none is newer. */
  readonly newest: PublishedRelease | undefined;
  readonly architecture: string;
}

/** What decides whether a container can update itself. */
export interface ContainerState {
  /** Undefined until a check has read the container. */
  readonly container: OfficeContainerRead | undefined;
  readonly newest: PublishedRelease | undefined;
}

/** What Update depends on, by how The Office was installed. */
export type UpdateState =
  | { readonly install: "checkout"; readonly checkout: CheckoutState | undefined }
  | ({ readonly install: "release" } & ReleaseState)
  | ({ readonly install: "container" } & ContainerState);

export const NO_LAUNCHER =
  "The Office wasn't started by its launcher (npm start), so it can't update itself.";
export const LOCAL_CHANGES = "The Office's checkout has local changes.";
export const NO_UPSTREAM = "The Office's checkout has no upstream branch.";

export const NOT_INSTALLED =
  "This copy of The Office wasn't installed into a releases folder, so it can't update itself.";
export const NO_REPOSITORY =
  "This release doesn't name the GitHub repository it comes from, so it can't look for newer ones.";

export const NO_DOCKER_SOCKET =
  "The Office can't reach Docker at /var/run/docker.sock, so it can't update itself. Mount the socket into its container, with Docker's group added (group_add), as the Docker Compose install does.";

export function diverged(upstream: string): string {
  return `The Office's checkout has diverged from ${upstream}.`;
}

export function noTarball(version: string, architecture: string): string {
  return `Version ${version} has no tarball for Linux on ${architecture} (${tarballName(version, architecture)} and its .sha256), so it can't be installed here. Wait for a release that has one.`;
}

export function notComposed(image: string, version: string | undefined): string {
  const pull = `docker pull ${image}:${version ?? "<version>"}`;
  return `The Office's container wasn't started by Docker Compose, so it can't update itself. Update it by hand: ${pull}, then create the container again from that image.`;
}

export function composeFilesElsewhere(folder: string, files: readonly string[]): string {
  return `The Office's compose files ${files.join(", ")} aren't inside its compose folder ${folder}, the only one the Office updater can reach. Move them into it.`;
}

/**
 * Why Update is refused, or undefined when it can go ahead: never where the system refuses it, and
 * otherwise by how The Office was installed.
 */
export function updateRefusal(
  state: UpdateState,
  { launched, systemRefusal }: { readonly launched: boolean; readonly systemRefusal?: string },
): string | undefined {
  if (systemRefusal) return systemRefusal;
  switch (state.install) {
    case "checkout":
      if (!launched) return NO_LAUNCHER;
      return state.checkout && checkoutRefusal(state.checkout);
    case "release":
      return releaseRefusal(state);
    case "container":
      return containerRefusal(state);
  }
}

/** A fast-forward of a clean checkout to its upstream. */
function checkoutRefusal(state: CheckoutState): string | undefined {
  if (state.localChanges) return LOCAL_CHANGES;
  if (!state.upstream) return NO_UPSTREAM;
  if (state.ahead > 0) return diverged(state.upstream);
  return undefined;
}

/** A release in its releases folder, under its launcher, with a tarball for this CPU. */
function releaseRefusal({
  installed,
  repository,
  newest,
  architecture,
}: ReleaseState): string | undefined {
  if (!installed) return NOT_INSTALLED;
  if (!repository) return NO_REPOSITORY;
  if (newest && !tarballAssetsOf(newest, architecture)) {
    return noTarball(newest.version, architecture);
  }
  return undefined;
}

/** A container Docker Compose started, with its files in its folder and Docker's socket in reach. */
function containerRefusal({ container: read, newest }: ContainerState): string | undefined {
  if (!read) return undefined;
  if (!read.reachable) return NO_DOCKER_SOCKET;
  const { compose, image } = read.container;
  if (!compose) return notComposed(imageRepository(image), newest?.version);
  const outside = composeFilesOutside(compose);
  if (outside.length > 0) return composeFilesElsewhere(compose.workingDirectory, outside);
  return undefined;
}
