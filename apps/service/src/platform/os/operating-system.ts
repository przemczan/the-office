/** The operating systems The Office runs on (spec §5.1). */
export type OperatingSystem = "windows" | "linux";

export function currentOperatingSystem(): OperatingSystem {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    default:
      throw new Error(`The Office runs on Windows and Linux, not on ${process.platform}.`);
  }
}
