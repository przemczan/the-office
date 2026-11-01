import { createHash } from "node:crypto";
import { SSH_PORT } from "./git-remote.js";

/** A host's public ssh key, with the fingerprint ssh shows for it. */
export interface HostKey {
  /** Its algorithm, as `ssh-ed25519`. */
  readonly type: string;
  /** The key itself, in base64. */
  readonly key: string;
  /** `SHA256:` and the base64 SHA-256 of the key without padding, as `ssh-keygen -l` prints it. */
  readonly fingerprint: string;
}

const KEY_TYPE =
  /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The host key of `<type> <key>`, as GitHub publishes and ssh-keyscan prints it; undefined for anything else. */
export function hostKeyOf(typeAndKey: string): HostKey | undefined {
  const [type = "", key = ""] = typeAndKey.trim().split(/\s+/);
  if (!KEY_TYPE.test(type) || !BASE64.test(key)) return undefined;
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest("base64");
  return { type, key, fingerprint: `SHA256:${digest.replace(/=+$/, "")}` };
}

/** How a known hosts file names a host: bare on ssh's own port, else `[host]:port`. */
export function knownHostName(host: string, port: number): string {
  return port === SSH_PORT ? host : `[${host}]:${port}`;
}

/** The line of a known hosts file that trusts `key` for the host. */
export function knownHostsLine(hostName: string, key: HostKey): string {
  return `${hostName} ${key.type} ${key.key}`;
}

/** The host names a known hosts file trusts a key for, from its plain lines. */
export function trustedHostNames(knownHosts: string): ReadonlySet<string> {
  return new Set(
    knownHosts
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("@"))
      .flatMap((line) => (line.split(/\s+/)[0] ?? "").split(",")),
  );
}
