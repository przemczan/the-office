import type { HostKey } from "../domain/host-keys.js";

/** Reads the keys an ssh host presents, before anything trusts them. */
export abstract class HostKeyScanner {
  abstract scan(host: string, port: number): Promise<readonly HostKey[]>;
}
