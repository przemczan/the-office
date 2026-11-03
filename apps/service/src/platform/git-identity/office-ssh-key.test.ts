import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../office-data/office-data-directory.js";
import { currentOperatingSystem } from "../os/current-operating-system.js";
import { isOwnerOnly } from "../os/owner-only.fixtures.js";
import { hostKeyOf } from "./host-keys.js";
import { IdentityFolder } from "./identity-folder.js";
import { OfficeSshKey } from "./office-ssh-key.js";

const run = promisify(execFile);
const { keygen } = currentOperatingSystem().sshPrograms;

/** An ssh-keygen that refuses every key, as one with no room left would. */
class FailingKeygenSshKey extends OfficeSshKey {
  protected override readonly keygen = join(tmpdir(), "no-such-ssh-keygen");
}

describe("OfficeSshKey", { timeout: 30_000 }, () => {
  let officeData: string;
  let sshKey: OfficeSshKey;

  beforeEach(async () => {
    // A space and a quote, as a user's folder may have.
    officeData = await mkdtemp(join(tmpdir(), "office key's "));
    sshKey = new OfficeSshKey(new IdentityFolder(new OfficeDataDirectory(officeData)));
  });

  afterEach(async () => {
    await rm(officeData, { recursive: true, force: true });
  });

  it("makes an ed25519 key once, readable by its owner only", async () => {
    const [first, second] = await Promise.all([sshKey.publicKey(), sshKey.publicKey()]);
    const again = await new OfficeSshKey(
      new IdentityFolder(new OfficeDataDirectory(officeData)),
    ).publicKey();

    expect(first).toMatch(/^ssh-ed25519 [A-Za-z0-9+/]+ the-office@/);
    expect(second).toBe(first);
    expect(again).toBe(first);
    expect(sshKey.privateKeyPath).toBe(join(officeData, "identity", "office_ssh_key"));
    expect(await isOwnerOnly(sshKey.privateKeyPath)).toBe(true);
    expect(await isOwnerOnly(join(officeData, "identity"))).toBe(true);
  });

  it("makes the public half again from a private half left alone", async () => {
    const made = await sshKey.publicKey();
    await rm(sshKey.publicKeyPath);

    const remade = await new OfficeSshKey(
      new IdentityFolder(new OfficeDataDirectory(officeData)),
    ).publicKey();

    expect(remade.split(" ").slice(0, 2)).toEqual(made.split(" ").slice(0, 2));
  });

  it("replaces a public half left without its private one", async () => {
    const made = await sshKey.publicKey();
    await rm(sshKey.privateKeyPath);

    const remade = await new OfficeSshKey(
      new IdentityFolder(new OfficeDataDirectory(officeData)),
    ).publicKey();

    expect(remade).not.toBe(made);
    expect(await readFile(sshKey.privateKeyPath, "utf8")).toContain("OPENSSH PRIVATE KEY");
  });

  it("regenerates the key in place, readable by its owner only", async () => {
    const made = await sshKey.publicKey();

    const [regenerated, again] = await Promise.all([sshKey.regenerate(), sshKey.regenerate()]);

    expect(regenerated).toMatch(/^ssh-ed25519 [A-Za-z0-9+/]+ the-office@/);
    expect(regenerated).not.toBe(made);
    expect(again).not.toBe(regenerated);
    expect(await sshKey.publicKey()).toBe(again);
    expect(await isOwnerOnly(sshKey.privateKeyPath)).toBe(true);
    const { stdout } = await run(keygen, ["-y", "-f", sshKey.privateKeyPath]);
    expect(stdout.split(" ").slice(0, 2)).toEqual(again.split(" ").slice(0, 2));
    expect(await readdir(join(officeData, "identity"))).not.toContain("office_ssh_key.new");
  });

  it("regenerates a key never made before", async () => {
    const regenerated = await sshKey.regenerate();

    expect(await sshKey.publicKey()).toBe(regenerated);
  });

  it("keeps the current key when ssh-keygen fails", async () => {
    const made = await sshKey.publicKey();
    const privateHalf = await readFile(sshKey.privateKeyPath, "utf8");
    const failing = new FailingKeygenSshKey(
      new IdentityFolder(new OfficeDataDirectory(officeData)),
    );

    await expect(failing.regenerate()).rejects.toThrow(/ssh-keygen could not make/);

    expect(await failing.publicKey()).toBe(made);
    expect(await readFile(sshKey.privateKeyPath, "utf8")).toBe(privateHalf);
  });

  it("has the fingerprint ssh-keygen shows", async () => {
    const publicKey = await sshKey.publicKey();

    const { stdout } = await run(keygen, ["-l", "-E", "sha256", "-f", sshKey.publicKeyPath]);

    expect(stdout.split(" ")[1]).toBe(hostKeyOf(publicKey)?.fingerprint);
  });
});
