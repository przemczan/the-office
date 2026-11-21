import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { DEVICE_HELPER_MOUNT } from "../domain/run-environment.js";
import { RunEnvironmentFolders } from "./run-environment-folders.js";

/** The machines the helper is built for, by `uname -m`'s names. */
export const DEVICE_HELPER_ARCHITECTURES = ["x86_64", "aarch64"] as const;
export type DeviceHelperArchitecture = (typeof DEVICE_HELPER_ARCHITECTURES)[number];

/** Why no helper can run: this Office has none to give. */
export const DEVICE_HELPER_NOT_BUILT =
  "The Office device helper isn't built (npm run build:device-helper).";

/** The file `npm run build:device-helper` writes the helper's version in, with no newline. */
const VERSION_FILE = "version";
const EXECUTABLE_MODE = 0o755;
const VERSION_MODE = 0o644;

/**
 * The folder the release, or a checkout's build, carries the helper in (`tools/device-helper/dist`):
 * none when The Office was given none, as a test app is.
 */
export class DeviceHelperSource {
  constructor(readonly folder: string | undefined) {}
}

/** The helper as this Office ships it, read once its files are copied. */
interface ShippedHelper {
  readonly version: string;
  readonly architectures: ReadonlySet<DeviceHelperArchitecture>;
}

/**
 * The Office device helper's files in `<office-data>/device-helper/` (spec §5.5, "The Office device
 * helper in a run environment"), which every Task's run environment mounts read-only: a Compose
 * install's Docker resolves mounts on the host, where the release inside The Office's container
 * isn't. `copy` runs from `office.ts`, so a test app never writes them.
 */
@Injectable()
export class DeviceHelperFiles {
  private copying: Promise<ShippedHelper | undefined> | undefined;

  constructor(
    private readonly source: DeviceHelperSource,
    private readonly folders: RunEnvironmentFolders,
  ) {}

  /**
   * Copies each built executable and then the version file, a file already the same left as it
   * is. Each is written beside its place and renamed over it, so a helper running in a container
   * keeps the file it started from and a new one never shows half written.
   */
  copy(): Promise<void> {
    this.copying = this.copyNow();
    return this.copying.then(() => undefined);
  }

  /** The executable's path inside the checks' service; none when this Office has none built for it. */
  async executableFor(architecture: DeviceHelperArchitecture): Promise<string | undefined> {
    const shipped = await this.shipped();
    if (shipped === undefined || !shipped.architectures.has(architecture)) return undefined;
    return posix.join(DEVICE_HELPER_MOUNT, executableName(architecture));
  }

  /** The version this Office ships; none when it isn't built. */
  async version(): Promise<string | undefined> {
    return (await this.shipped())?.version;
  }

  /**
   * Why a helper whose HELLO says `helloVersion` isn't taken, in the UI's words; none when it is
   * this Office's own version.
   */
  async helloProblemOf(helloVersion: string): Promise<string | undefined> {
    const version = await this.version();
    if (version === undefined) return DEVICE_HELPER_NOT_BUILT;
    if (helloVersion === version) return undefined;
    return `The Office device helper is version ${helloVersion}; this Office is ${version}.`;
  }

  /** Once the copy ends: a copy that failed, which `copy` answered, leaves none to run. */
  private async shipped(): Promise<ShippedHelper | undefined> {
    return (await this.copying?.catch(() => undefined)) ?? undefined;
  }

  private async copyNow(): Promise<ShippedHelper | undefined> {
    const from = this.source.folder;
    if (from === undefined) return undefined;
    const version = await readFile(join(from, VERSION_FILE), "utf8").catch(() => undefined);
    if (version === undefined || version.trim() === "") return undefined;
    const target = this.folders.deviceHelper;
    await mkdir(target, { recursive: true });
    const architectures = new Set<DeviceHelperArchitecture>();
    for (const architecture of DEVICE_HELPER_ARCHITECTURES) {
      const name = executableName(architecture);
      if (!(await isFile(join(from, name)))) continue;
      await placeFile(join(from, name), target, name, EXECUTABLE_MODE);
      architectures.add(architecture);
    }
    // Last, so the version there never names executables not yet copied.
    await placeFile(join(from, VERSION_FILE), target, VERSION_FILE, VERSION_MODE);
    return { version: version.trim(), architectures };
  }
}

function executableName(architecture: DeviceHelperArchitecture): string {
  return `office-device-helper-${architecture}`;
}

/** Copies the file to `folder/name` with the mode, unless the same file is there already. */
async function placeFile(
  source: string,
  folder: string,
  name: string,
  mode: number,
): Promise<void> {
  const destination = join(folder, name);
  if (await sameFile(source, destination, mode)) return;
  const temporary = join(folder, `.${name}.${randomUUID()}.tmp`);
  try {
    await copyFile(source, temporary);
    await chmod(temporary, mode);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function sameFile(source: string, destination: string, mode: number): Promise<boolean> {
  const there = await stat(destination).catch(() => undefined);
  if (there === undefined || (there.mode & 0o777) !== mode) return false;
  if (there.size !== (await stat(source)).size) return false;
  const [given, kept] = await Promise.all([readFile(source), readFile(destination)]);
  return given.equals(kept);
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    (found) => found.isFile(),
    () => false,
  );
}
