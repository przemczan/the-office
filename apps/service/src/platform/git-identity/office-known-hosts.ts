import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { fetchFailure } from "../http/fetch-failure.js";
import { KeyedLocks } from "../locks/keyed-locks.js";
import { SSH_PORT } from "./git-remote.js";
import { GitHubSite, gitHubMetaUrlOf, gitHubSshHostOf } from "./github-site.js";
import { HostKeyScanner } from "./host-key-scanner.js";
import {
  hostKeyOf,
  knownHostName,
  knownHostsLine,
  trustedHostKeys,
  trustedHostNames,
  type HostKey,
  type SshHost,
  type TrustedHost,
} from "./host-keys.js";
import { IdentityFolder } from "./identity-folder.js";

const META_TIMEOUT_MS = 30_000;
const metaSchema = z.object({ ssh_keys: z.array(z.string()).min(1) });

/** A host key the user's confirmation doesn't hold for: the host shows no key with that fingerprint. */
export class HostKeyRefused extends Error {
  constructor(
    readonly host: string,
    readonly fingerprint: string,
  ) {
    super(`${host} shows no key with the fingerprint ${fingerprint}, so it is not trusted.`);
    this.name = "HostKeyRefused";
  }
}

/**
 * The hosts The Office's ssh trusts, in a known hosts file of its own (spec §5.5 Defaults, the
 * Office identity): GitHub's keys from GitHub's published list, any other host's only once the
 * user confirms its fingerprint. The user's own known hosts are never read.
 */
@Injectable()
export class OfficeKnownHosts {
  readonly path: string;
  /** The host GitHub's ssh remotes name, whose keys come from GitHub's published list. */
  readonly gitHubHost: string;
  private readonly gitHubMetaUrl: string;
  private readonly writes = new KeyedLocks();
  /**
   * Hosts an Office git command was refused for, by their known hosts name, until the user
   * confirms one. Kept in memory: the next command refused after a restart lists its host again.
   */
  private readonly waitingHosts = new Map<string, SshHost>();

  constructor(
    private readonly folder: IdentityFolder,
    private readonly scanner: HostKeyScanner,
    gitHub: GitHubSite,
  ) {
    this.path = folder.file("known_hosts");
    this.gitHubHost = gitHubSshHostOf(gitHub);
    this.gitHubMetaUrl = gitHubMetaUrlOf(gitHub);
  }

  /** Whether `host` is GitHub's, trusted from GitHub's published list when first needed. */
  isGitHub(host: string, port: number): boolean {
    return host === this.gitHubHost && port === SSH_PORT;
  }

  async isTrusted(host: string, port: number): Promise<boolean> {
    return trustedHostNames(await this.read()).has(knownHostName(host, port));
  }

  /** The hosts trusted now, each with its keys, GitHub's among them once it was first reached. */
  async trusted(): Promise<readonly TrustedHost[]> {
    return trustedHostKeys(await this.read());
  }

  /** The hosts refused while their fingerprint waits for the user's confirmation, oldest first. */
  async waiting(): Promise<readonly SshHost[]> {
    const trusted = trustedHostNames(await this.read());
    return [...this.waitingHosts].filter(([name]) => !trusted.has(name)).map(([, host]) => host);
  }

  /** Lists `host` as waiting for its fingerprint to be confirmed, unless it is trusted or GitHub's. */
  async awaitConfirmation(host: string, port: number): Promise<void> {
    if (this.isGitHub(host, port) || (await this.isTrusted(host, port))) return;
    this.waitingHosts.set(knownHostName(host, port), { host, port });
  }

  /** Trusts GitHub's published keys, read from GitHub the first time only. */
  async trustGitHub(): Promise<void> {
    if (await this.isTrusted(this.gitHubHost, SSH_PORT)) return;
    const keys = await this.gitHubKeys();
    await this.add(this.gitHubHost, SSH_PORT, keys);
  }

  /** The keys the host presents now, for the user to compare their fingerprints with the host's. */
  scan(host: string, port: number): Promise<readonly HostKey[]> {
    return this.scanner.scan(host, port);
  }

  /**
   * Trusts the host's key with the fingerprint the user confirmed, read again from the host so
   * that only the key the user saw is kept; refused when the host no longer shows it.
   */
  async confirm(host: string, port: number, fingerprint: string): Promise<void> {
    const confirmed = (await this.scanner.scan(host, port)).filter(
      (key) => key.fingerprint === fingerprint,
    );
    if (confirmed.length === 0) throw new HostKeyRefused(knownHostName(host, port), fingerprint);
    await this.add(host, port, confirmed);
    this.waitingHosts.delete(knownHostName(host, port));
  }

  private async gitHubKeys(): Promise<HostKey[]> {
    const failed = (reason: string): Error =>
      new Error(`GitHub's ssh host keys could not be read from ${this.gitHubMetaUrl}: ${reason}.`);
    let response: Response;
    let body: unknown;
    try {
      response = await fetch(this.gitHubMetaUrl, {
        headers: { accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(META_TIMEOUT_MS),
      });
      body = response.ok ? await response.json() : undefined;
    } catch (error) {
      throw failed(fetchFailure(error, META_TIMEOUT_MS));
    }
    if (!response.ok) throw failed(`it answered ${response.status}`);
    const meta = metaSchema.safeParse(body);
    const keys = meta.success ? meta.data.ssh_keys.map(hostKeyOf) : [];
    if (keys.length === 0 || keys.some((key) => key === undefined)) {
      throw failed("its answer holds no list of ssh keys");
    }
    return keys.filter((key): key is HostKey => key !== undefined);
  }

  private add(host: string, port: number, keys: readonly HostKey[]): Promise<void> {
    return this.writes.run(this.path, async () => {
      await this.folder.prepare();
      const name = knownHostName(host, port);
      const current = await this.read();
      const lines = keys.map((key) => knownHostsLine(name, key));
      const kept = current.split(/\r?\n/).filter((line) => line.trim() !== "");
      const added = lines.filter((line) => !kept.includes(line));
      if (added.length === 0) return;
      // Written beside it and renamed over it, so ssh never reads half a file.
      const written = `${this.path}.${randomUUID()}`;
      await writeFile(written, [...kept, ...added, ""].join("\n"), { mode: 0o600 });
      await rename(written, this.path);
    });
  }

  private async read(): Promise<string> {
    try {
      return await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  }
}
