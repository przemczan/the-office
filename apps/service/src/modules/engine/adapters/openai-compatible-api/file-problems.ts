/** What went wrong with a file, in words the model can act on. */
export function fileProblem(path: string, error: unknown): string {
  switch (errorCode(error)) {
    case "ENOENT":
      return `${path} does not exist.`;
    case "EISDIR":
      return `${path} is a directory, not a file.`;
    case "ENOTDIR":
      return `A folder on the way to ${path} is a file.`;
    case "EACCES":
    case "EPERM":
      return `${path} can't be opened: permission denied.`;
    default:
      return `${path} couldn't be used: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function isMissing(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

/** A NUL byte in the first part marks a file as binary, as Git and ripgrep tell them apart. */
export function isBinary(content: Buffer): boolean {
  return content.subarray(0, 8000).includes(0);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}
