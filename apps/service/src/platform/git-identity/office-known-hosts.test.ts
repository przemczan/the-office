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
});
