import { homedir } from "node:os";
import { linux } from "./linux.js";
import type { OperatingSystem } from "./operating-system.js";
import { windows } from "./windows.js";

/** The system The Office runs on, for the user it runs as. The only reader of process.platform. */
export function currentOperatingSystem(): OperatingSystem {
  const user = { variables: process.env, homeDirectory: homedir(), userId: process.getuid?.() };
  switch (process.platform) {
    case "win32":
      return windows(user);
    case "linux":
      return linux(user);
    default:
      throw new Error(`The Office runs on Windows and Linux, not on ${process.platform}.`);
  }
}
