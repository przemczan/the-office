import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../platform/os/current-operating-system.js";
import { isOwnerOnly } from "../../../platform/os/owner-only.fixtures.js";
import { IdentityFolder } from "./identity-folder.js";
import { OfficeSshKey } from "./office-ssh-key.js";

const run = promisify(execFile);
const { keygen } = currentOperatingSystem().sshPrograms;

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
});
