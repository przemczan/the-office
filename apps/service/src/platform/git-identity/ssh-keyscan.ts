import { execFile } from "node:child_process";
import { Injectable } from "@nestjs/common";
import { currentOperatingSystem } from "../os/current-operating-system.js";
import { HostKeyScanner } from "./host-key-scanner.js";
import { hostKeyOf, type HostKey } from "./host-keys.js";

const TIMEOUT_SECONDS = 10;
/** A host name or an address; never one starting with `-`, which a program would read as an option. */
const HOST = /^[A-Za-z0-9_.:][A-Za-z0-9_.:-]*$/;

/** Reads a host's keys with `ssh-keyscan`, from the OpenSSH git runs. */
@Injectable()
export class SshKeyscan extends HostKeyScanner {
  private readonly program = currentOperatingSystem().sshPrograms.keyscan;

  scan(host: string, port: number): Promise<readonly HostKey[]> {
    if (!HOST.test(host)) return Promise.reject(new Error(`"${host}" is no host name.`));
    return new Promise((resolve, reject) => {
      execFile(
        this.program,
        ["-T", String(TIMEOUT_SECONDS), "-p", String(port), "--", host],
        { timeout: (TIMEOUT_SECONDS + 5) * 1000, windowsHide: true },
        (error, stdout) => {
          // It exits with 1 when the host answered with no key, which the empty list says.
          if (error && typeof error.code !== "number") {
            reject(new Error(`ssh-keyscan could not run: ${error.message}`, { cause: error }));
          } else {
            resolve(keysFromKeyscan(stdout));
          }
        },
      );
    });
  }
}

/** The keys in ssh-keyscan's output, a `<host> <type> <key>` line each. */
export function keysFromKeyscan(output: string): HostKey[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !line.startsWith("#"))
    .map((line) => hostKeyOf(line.trim().split(/\s+/).slice(1).join(" ")))
    .filter((key): key is HostKey => key !== undefined);
}
