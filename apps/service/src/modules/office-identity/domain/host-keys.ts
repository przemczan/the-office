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

/** A host reached over ssh, by its name or address and the port its ssh listens on. */
export interface SshHost {
  readonly host: string;
  readonly port: number;
}

/** A host a known hosts file trusts, with the keys it trusts for it. */
export interface TrustedHost extends SshHost {
  readonly keys: readonly HostKey[];
}

/** The host names a known hosts file trusts a key for, from its plain lines. */
export function trustedHostNames(knownHosts: string): ReadonlySet<string> {
  return new Set(trustedEntries(knownHosts).flatMap(({ names }) => names));
}

/** The hosts a known hosts file trusts, in the order it first names them, with their keys. */
export function trustedHostKeys(knownHosts: string): TrustedHost[] {
  const hosts = new Map<string, { host: SshHost; keys: HostKey[] }>();
  for (const { names, key } of trustedEntries(knownHosts)) {
    for (const name of names) {
      const host = sshHostOf(name);
      if (host === undefined) continue;
      const trusted = hosts.get(name) ?? { host, keys: [] };
      if (key !== undefined) trusted.keys.push(key);
      hosts.set(name, trusted);
    }
  }
  return [...hosts.values()].map(({ host, keys }) => ({ ...host, keys }));
}

function trustedEntries(
  knownHosts: string,
): { readonly names: readonly string[]; readonly key: HostKey | undefined }[] {
  return knownHosts
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("@"))
    .map((line) => {
      const [names = "", ...typeAndKey] = line.split(/\s+/);
      return { names: names.split(","), key: hostKeyOf(typeAndKey.join(" ")) };
    });
}

/** The host a known hosts name stands for: `host` on ssh's own port, or `[host]:port`. */
function sshHostOf(name: string): SshHost | undefined {
  const bracketed = /^\[([^\]]+)\]:(\d+)$/.exec(name);
  if (bracketed) return { host: bracketed[1] ?? "", port: Number(bracketed[2]) };
  // A hashed name (`|1|…`) doesn't say which host it is; The Office writes none.
  return name === "" || name.startsWith("|") ? undefined : { host: name, port: SSH_PORT };
}
