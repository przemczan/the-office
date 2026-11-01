import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../office-data/office-data-directory.js";
import {
  GITHUB_ED25519,
  startFakeGitHubMeta,
  type FakeGitHubMeta,
} from "./fake-github-meta.fixtures.js";
import { HostKeyScanner } from "./host-key-scanner.js";
import { hostKeyOf, type HostKey } from "./host-keys.js";
import { IdentityFolder } from "./identity-folder.js";
import { HostKeyRefused, OfficeKnownHosts } from "./office-known-hosts.js";
import { keysFromKeyscan } from "./ssh-keyscan.js";

const OTHER_ED25519 =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIazEu89wgQZ4bqs3d63QSEzYVa0MuJ2e2gKTKqu+UUO";

function key(typeAndKey: string): HostKey {
  const parsed = hostKeyOf(typeAndKey);
  if (parsed === undefined) throw new Error(`No key: ${typeAndKey}`);
  return parsed;
}

class FakeScanner extends HostKeyScanner {
  keys: readonly HostKey[] = [key(OTHER_ED25519)];
  scan(): Promise<readonly HostKey[]> {
    return Promise.resolve(this.keys);
  }
}

describe("OfficeKnownHosts", () => {
  let officeData: string;
  let meta: FakeGitHubMeta;
  let scanner: FakeScanner;
  let knownHosts: OfficeKnownHosts;

  beforeEach(async () => {
    officeData = await mkdtemp(join(tmpdir(), "office-known-hosts-"));
    meta = await startFakeGitHubMeta();
    scanner = new FakeScanner();
    knownHosts = new OfficeKnownHosts(
      new IdentityFolder(new OfficeDataDirectory(officeData)),
      scanner,
      meta.site,
    );
  });

  afterEach(async () => {
    await meta.close();
    await rm(officeData, { recursive: true, force: true });
  });

  it("trusts GitHub's published keys, read the first time only", async () => {
    await knownHosts.trustGitHub();
    await knownHosts.trustGitHub();

    expect(meta.requests).toBe(1);
    expect(await readFile(knownHosts.path, "utf8")).toBe(`github.com ${GITHUB_ED25519}\n`);
    expect(await knownHosts.isTrusted("github.com", 22)).toBe(true);
  });

  it("says why GitHub's keys could not be read", async () => {
    meta.body = { ssh_keys: ["not a key"] };

    await expect(knownHosts.trustGitHub()).rejects.toThrow(
      /GitHub's ssh host keys could not be read from .*: its answer holds no list of ssh keys\./,
    );
    expect(await knownHosts.isTrusted("github.com", 22)).toBe(false);
  });

  it("trusts no other host until the user confirms its fingerprint", async () => {
    const [shown] = await knownHosts.scan("git.example.com", 22);

    expect(await knownHosts.isTrusted("git.example.com", 22)).toBe(false);
    await knownHosts.confirm("git.example.com", 22, shown?.fingerprint ?? "");
    expect(await knownHosts.isTrusted("git.example.com", 22)).toBe(true);
    expect(await readFile(knownHosts.path, "utf8")).toBe(`git.example.com ${OTHER_ED25519}\n`);
  });

  it("refuses a fingerprint the host no longer shows", async () => {
    const [shown] = await knownHosts.scan("git.example.com", 2222);
    scanner.keys = [key(GITHUB_ED25519)];

    await expect(
      knownHosts.confirm("git.example.com", 2222, shown?.fingerprint ?? ""),
    ).rejects.toThrow(HostKeyRefused);
    expect(await knownHosts.isTrusted("git.example.com", 2222)).toBe(false);
  });

  it("lists the Trusted hosts with their keys, and an Unconfirmed host until it is confirmed", async () => {
    await knownHosts.addUnconfirmed("git.example.com", 2222);
    await knownHosts.addUnconfirmed("github.com", 22);
    expect(await knownHosts.unconfirmed()).toEqual([{ host: "git.example.com", port: 2222 }]);

    await knownHosts.confirm("git.example.com", 2222, key(OTHER_ED25519).fingerprint);
    await knownHosts.trustGitHub();

    expect(await knownHosts.unconfirmed()).toEqual([]);
    expect(await knownHosts.trusted()).toEqual([
      { host: "git.example.com", port: 2222, keys: [key(OTHER_ED25519)] },
      { host: "github.com", port: 22, keys: [key(GITHUB_ED25519)] },
    ]);
  });

  it("trusts GitHub's keys for the host of the website it is given", async () => {
    const elsewhere = new OfficeKnownHosts(
      new IdentityFolder(new OfficeDataDirectory(officeData)),
      scanner,
      { ...meta.site, webUrl: "http://127.0.0.1:4391" },
    );

    await elsewhere.trustGitHub();

    expect(elsewhere.isGitHub("127.0.0.1", 22)).toBe(true);
    expect(elsewhere.isGitHub("github.com", 22)).toBe(false);
    expect(await elsewhere.isTrusted("127.0.0.1", 22)).toBe(true);
  });

  it("names a host on another port as ssh does", async () => {
    await knownHosts.confirm("git.example.com", 2222, key(OTHER_ED25519).fingerprint);
    await knownHosts.trustGitHub();

    expect(await knownHosts.isTrusted("git.example.com", 2222)).toBe(true);
    expect(await knownHosts.isTrusted("git.example.com", 22)).toBe(false);
    expect(await readFile(knownHosts.path, "utf8")).toBe(
      `[git.example.com]:2222 ${OTHER_ED25519}\ngithub.com ${GITHUB_ED25519}\n`,
    );
  });
});

describe("hostKeyOf", () => {
  it("has the fingerprint GitHub publishes for its key", () => {
    expect(key(GITHUB_ED25519).fingerprint).toBe(
      "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU",
    );
  });

  it("takes no unknown algorithm", () => {
    expect(hostKeyOf("ssh-dss AAAAB3NzaC1kc3M=")).toBeUndefined();
  });
});

describe("keysFromKeyscan", () => {
  it("reads the keys and skips the comments", () => {
    const output = `# example.com:22 SSH-2.0-OpenSSH_9.6\nexample.com ${OTHER_ED25519}\n[example.com]:2222 ${GITHUB_ED25519}\n`;

    expect(keysFromKeyscan(output)).toEqual([key(OTHER_ED25519), key(GITHUB_ED25519)]);
  });
});
