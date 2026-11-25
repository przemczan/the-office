import { posix } from "node:path";
import type { ActiveInstanceName } from "./test-instance-settings.js";

/**
 * How long an Install on a device's install step may run, connecting to the device included
 * (spec §2.12, Defaults "Install time"); its build has the Build time of its own.
 */
export const INSTALL_TIMEOUT_MINUTES = 5;
export const INSTALL_TIMEOUT_MS = INSTALL_TIMEOUT_MINUTES * 60_000;

/** Why an install that ran past its time failed. */
export const INSTALL_RAN_OUT = `The install ran out of its ${INSTALL_TIMEOUT_MINUTES} minutes.`;

/** Why an install whose build kept no `.apk` failed (spec §2.12, "Installing"). */
export const NO_APK = "The build made no .apk file to install.";

/** Why an install whose build target the Project no longer has as a Build to install one fails. */
export function buildTargetGone(buildTargetKey: string): string {
  return `The Build to install target ${buildTargetKey} this target installs is gone; pick another in the Project's Test targets.`;
}

/** Why an install whose build failed failed, in the build's own words. */
export function buildFailed(reason: string | undefined): string {
  if (reason === undefined || reason === "") return "The build failed.";
  return `The build failed: ${reason.endsWith(".") ? reason.slice(0, -1) : reason}.`;
}

/** Why an install whose device was let go of before it ended failed. */
export function deviceLetGo(deviceName: string): string {
  return `${deviceName} was disconnected before the install ended.`;
}

/** Said when the device didn't answer adb (spec §2.13, "States"). */
export function deviceDidNotAnswer(deviceName: string): string {
  return `${deviceName} didn't answer.`;
}

/**
 * The name an Install on a device instance goes by where its device's holder is named: "<target>
 * in <Initiative>" when linked, else "<target> on <branch>", as the limit's refusal names it.
 */
export function holderNameOf(name: ActiveInstanceName): string {
  return "initiativeName" in name
    ? `${name.targetName} in ${name.initiativeName}`
    : `${name.targetName} on ${name.branch}`;
}

/** The log's line naming the build an instance reuses: its commit, when it was Built and its id. */
export function reusingWords(build: {
  readonly id: string;
  readonly commit: string | undefined;
  readonly builtAt: Date;
}): string {
  const commit = build.commit === undefined ? "an earlier commit" : build.commit.slice(0, 7);
  const [day, time] = build.builtAt.toISOString().split("T") as [string, string];
  return `Reusing the files Built from ${commit} on ${day} at ${time.slice(0, 5)} UTC. Its build: the Test instance ${build.id}.`;
}

/** The log's line naming the build an instance launched, whose log has its output. */
export function buildingWords(buildId: string, targetName: string): string {
  return `Building ${targetName} first: the Test instance ${buildId}, whose log has the build's output.`;
}

/** Of a build's kept files, the `.apk` ones to install and the others, which are ignored. */
export function apksOf(names: readonly string[]): {
  readonly apks: readonly string[];
  readonly others: readonly string[];
} {
  return { apks: names.filter(isApk), others: names.filter((name) => !isApk(name)) };
}

function isApk(name: string): boolean {
  return name.toLowerCase().endsWith(".apk");
}

/** The log's line for the files not installed. */
export function ignoredWords(others: readonly string[]): string {
  return `Not installing ${others.join(", ")}: only .apk files are installed.`;
}

/**
 * adb's arguments for the install, every file read from the build's files' mount: `install -r`
 * for one `.apk`, `install-multiple -r` for several, the split APKs of one app (spec §2.12,
 * "Installing"). The serial is given with `-s`, as an attached program gets no variables.
 */
export function adbInstallArguments(
  serial: string,
  mount: string,
  apks: readonly string[],
): string[] {
  const files = apks.map((name) => posix.join(mount, name));
  return ["-s", serial, apks.length === 1 ? "install" : "install-multiple", "-r", ...files];
}

/** How adb's install ended: its exit code when it ended by itself, and what it printed. */
export interface AdbInstallEnd {
  readonly exitCode: number | undefined;
  readonly output: string;
}

/**
 * Why adb's install failed, in the user's words; undefined when it answered `Success`. A phone's
 * refusal names its code ("The phone refused the install: INSTALL_FAILED_UPDATE_INCOMPATIBLE."),
 * a device adb can't reach "<device> didn't answer.".
 */
export function installFailureOf(end: AdbInstallEnd, deviceName: string): string | undefined {
  const lines = end.output.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes("Success")) return undefined;
  const refused = /Failure \[([A-Z0-9_]+)/.exec(end.output);
  if (refused) return `The phone refused the install: ${refused[1]}.`;
  if (
    /device .* not found|device offline|no devices|unauthorized|not connected/i.test(end.output)
  ) {
    return deviceDidNotAnswer(deviceName);
  }
  const said = lines.findLast((line) => line !== "");
  if (said !== undefined) return `adb couldn't install the app: ${said}`;
  return end.exitCode === undefined
    ? "adb ended without an exit code."
    : `adb ended with exit code ${end.exitCode}.`;
}
