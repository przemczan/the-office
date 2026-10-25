import { posix, win32 } from "node:path";
import type { OperatingSystem } from "./operating-system.js";

const DIRECTORY_NAME = "the-office";

/** What the default depends on, read from the process by the caller so both systems can be tested anywhere. */
export interface UserLocations {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory: string;
}

/** Where the Office data directory lives when OFFICE_DATA_DIR is not set (Build defaults in docs/tasks/README.md). */
export function defaultOfficeDataDirectory(
  operatingSystem: OperatingSystem,
  { environment, homeDirectory }: UserLocations,
): string {
  switch (operatingSystem) {
    case "windows":
      return win32.join(
        environment["LOCALAPPDATA"] || win32.join(homeDirectory, "AppData", "Local"),
        DIRECTORY_NAME,
      );
    case "linux":
      return posix.join(linuxDataHome(environment["XDG_DATA_HOME"], homeDirectory), DIRECTORY_NAME);
  }
}

// The XDG Base Directory spec says a relative XDG_DATA_HOME is invalid and is to be ignored.
function linuxDataHome(xdgDataHome: string | undefined, homeDirectory: string): string {
  return xdgDataHome && posix.isAbsolute(xdgDataHome)
    ? xdgDataHome
    : posix.join(homeDirectory, ".local", "share");
}
