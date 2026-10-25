export interface PathRules {
  /** Joins and normalizes path segments with this system's separator. */
  join(...segments: string[]): string;
  /** Separates the directories listed in PATH. */
  readonly pathListSeparator: string;
  /**
   * Why a path is too long for the programs The Office runs on it (git, shells, a Project's tools),
   * or undefined when it fits. A directory may be shorter than a file on Windows.
   */
  lengthProblem(path: string, entry: PathEntry): string | undefined;
}

export type PathEntry = "file" | "directory";

export interface PathLimits {
  /** The longest a whole path may be, without the terminating NUL. */
  readonly pathLength: Readonly<Record<PathEntry, number>>;
  /** The longest one segment of a path may be. */
  readonly nameLength: number;
  readonly unit: "characters" | "bytes";
  readonly separators: RegExp;
  measure(text: string): number;
}

/** Checks a path against the limits of one system, naming the limit it breaks. */
export function pathLengthProblem(
  path: string,
  entry: PathEntry,
  limits: PathLimits,
): string | undefined {
  const pathLength = limits.measure(path);
  const maximumPathLength = limits.pathLength[entry];
  if (pathLength > maximumPathLength) {
    return `The path is ${pathLength} ${limits.unit} long; a ${entry} path may be at most ${maximumPathLength}.`;
  }
  const longName = path
    .split(limits.separators)
    .find((name) => limits.measure(name) > limits.nameLength);
  return longName === undefined
    ? undefined
    : `"${longName}" is ${limits.measure(longName)} ${limits.unit} long; a name in a path may be at most ${limits.nameLength}.`;
}
