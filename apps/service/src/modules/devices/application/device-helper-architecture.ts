import { arch } from "node:os";
import type { DeviceHelperArchitecture } from "../../run-environments/index.js";

/** The helper's executable for this computer's machine: a run environment's is the host's. */
export function hostHelperArchitecture(): DeviceHelperArchitecture {
  return arch() === "arm64" ? "aarch64" : "x86_64";
}
