import { posix } from "node:path";
import type { TestInstance } from "./test-instance.js";

/** How long a Build to install build may run before it is ended (spec §2.12, Defaults). */
export const BUILD_TIMEOUT_MINUTES = 60;
export const BUILD_TIMEOUT_MS = BUILD_TIMEOUT_MINUTES * 60_000;

/**
 * How many Built instances keep their files per target per Initiative, or per target per branch
 * for builds linked to no Initiative (spec §2.12, Defaults).
 */
export const KEPT_BUILDS = 3;

/** How long after its Initiative is Done or Dropped a build keeps its files (spec §2.12, Defaults). */
export const KEPT_AFTER_INITIATIVE_ENDS_DAYS = 7;

/** How long after it was Built a build linked to no Initiative keeps its files (spec §2.12, Defaults). */
export const KEPT_AFTER_BUILT_DAYS = 7;
const DAY_MS = 24 * 60 * 60_000;

/** How long a QR code's link to one file works (spec §2.12, "Build to install"). */
export const TEST_BUILD_LINK_MS = 60 * 60_000;

/** How a build ended, as the build path learns it from the run environment or the workstation. */
export interface BuildEnd {
  readonly exitCode: number | undefined;
  readonly endedBy?: "timeout" | "stop" | "could-not-run" | undefined;
}

/**
 * Why a build that ended didn't succeed, in the user's words; undefined when it exited 0. A build
 * stopped answers undefined too: the stop has written how it ended.
 */
export function buildFailureOf(end: BuildEnd): string | undefined {
  switch (end.endedBy) {
    case "timeout":
      return `The build ran out of its ${BUILD_TIMEOUT_MINUTES} minutes.`;
    case "could-not-run":
      return "The build couldn't run.";
    case "stop":
      return undefined;
    default:
      if (end.exitCode === 0) return undefined;
      return end.exitCode === undefined
        ? "The build ended without an exit code."
        : `The build ended with exit code ${end.exitCode}.`;
  }
}

/** Why an output pattern is refused before anything is matched: it leads out of the checkout. */
export function outputPatternProblem(pattern: string): string | undefined {
  const path = pattern.trim().replaceAll("\\", "/");
  if (path === "") return "An output pattern is empty.";
  if (posix.isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.split("/").includes("..")) {
    return `The output pattern ${pattern} leads outside the checkout.`;
  }
  return undefined;
}

export function noMatch(patterns: readonly string[]): string {
  return `No file matched ${patterns.join(", ")}.`;
}

export function outsideTheCheckout(match: string): string {
  return `${match} resolves outside the checkout, so no file was kept.`;
}

/**
 * The names the matched files are kept under in `test-builds/<id>/`: each its base name, a second
 * file of the same name `<name>-2<ext>`, a third `<name>-3<ext>`, and so on.
 */
export function keptNamesOf(paths: readonly string[]): string[] {
  const taken = new Set<string>();
  return paths.map((path) => {
    const base = posix.basename(path.replaceAll("\\", "/"));
    const extension = posix.extname(base);
    const stem = base.slice(0, base.length - extension.length);
    let name = base;
    for (let count = 2; taken.has(name); count++) name = `${stem}-${count}${extension}`;
    taken.add(name);
    return name;
  });
}

/** The media type a kept file is served with: an APK as Android installs it, else plain bytes. */
export function mediaTypeOf(name: string): string {
  return name.toLowerCase().endsWith(".apk")
    ? "application/vnd.android.package-archive"
    : "application/octet-stream";
}

/** Whether the instance's files are there to download: Built, listed and not removed. */
export function hasFile(instance: TestInstance, name: string): boolean {
  return (
    instance.state === "built" &&
    instance.filesRemovedAt === undefined &&
    instance.files.some((file) => file.name === name)
  );
}

/**
 * Of one target's Built instances with their files on one Initiative, or on one branch for builds
 * linked to none, the ones past the newest `KEPT_BUILDS`, whose files go.
 */
export function buildsPastTheKept(builds: readonly TestInstance[]): TestInstance[] {
  return builds
    .filter(({ state, filesRemovedAt }) => state === "built" && filesRemovedAt === undefined)
    .toSorted(
      (one, other) =>
        builtAtOf(other) - builtAtOf(one) || other.launchedAt.getTime() - one.launchedAt.getTime(),
    )
    .slice(KEPT_BUILDS);
}

/** Whether an Initiative that ended at `endedAt` has been ended long enough to drop its builds. */
export function initiativeEndedLongAgo(endedAt: Date | undefined, now: Date): boolean {
  return (
    endedAt !== undefined &&
    now.getTime() - endedAt.getTime() >= KEPT_AFTER_INITIATIVE_ENDS_DAYS * DAY_MS
  );
}

/** Whether a build linked to no Initiative was Built long enough ago to drop its files. */
export function builtLongAgo(instance: TestInstance, now: Date): boolean {
  return now.getTime() - builtAtOf(instance) >= KEPT_AFTER_BUILT_DAYS * DAY_MS;
}

export const FILES_REMOVED_FOR_NEWER = `The files were removed: the newest ${KEPT_BUILDS} builds are kept.`;

export function filesRemovedAsInitiativeEnded(state: "done" | "dropped"): string {
  return `The files were removed: the Initiative has been ${state === "done" ? "Done" : "Dropped"} for ${KEPT_AFTER_INITIATIVE_ENDS_DAYS} days.`;
}

export const FILES_REMOVED_AFTER_BUILT = `The files were removed: they were Built ${KEPT_AFTER_BUILT_DAYS} days ago.`;

function builtAtOf(instance: TestInstance): number {
  return (instance.endedAt ?? instance.launchedAt).getTime();
}
