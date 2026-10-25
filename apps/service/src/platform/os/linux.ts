import { posix } from "node:path";
import type { OperatingSystem, UserEnvironment } from "./operating-system.js";
import { pathLengthProblem, type PathLimits, type PathRules } from "./path-rules.js";
import type { Shell } from "./shell.js";

// PATH_MAX is 4096 bytes with the terminating NUL and NAME_MAX 255 bytes (linux/limits.h).
const LINUX_PATH_LIMITS: PathLimits = {
  pathLength: { file: 4095, directory: 4095 },
  nameLength: 255,
  unit: "bytes",
  separators: /\//,
  measure: (text) => Buffer.byteLength(text, "utf8"),
};

export function linux({ variables, homeDirectory }: UserEnvironment): OperatingSystem {
  return {
    name: "Linux",
    defaultOfficeDataDirectory: posix.join(
      dataHome(variables["XDG_DATA_HOME"], homeDirectory),
      "the-office",
    ),
    paths: linuxPaths,
    defaultShell: bourneShell,
  };
}

// The XDG Base Directory spec says a relative XDG_DATA_HOME is invalid and is to be ignored.
function dataHome(xdgDataHome: string | undefined, homeDirectory: string): string {
  return xdgDataHome && posix.isAbsolute(xdgDataHome)
    ? xdgDataHome
    : posix.join(homeDirectory, ".local", "share");
}

const linuxPaths: PathRules = {
  join: (...segments) => posix.join(...segments),
  pathListSeparator: posix.delimiter,
  lengthProblem: (path, entry) => pathLengthProblem(path, entry, LINUX_PATH_LIMITS),
};

const bourneShell: Shell = {
  name: "sh",
  invocation: (commandLine) => ({
    file: "/bin/sh",
    arguments: ["-c", commandLine],
    windowsVerbatimArguments: false,
  }),
};
