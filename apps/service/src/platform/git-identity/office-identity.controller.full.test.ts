import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  knownHostsSchema,
  officeSshKeySchema,
  scannedHostSchema,
  type KnownHosts,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../test/test-application.js";
import { OfficeDataModule } from "../office-data/office-data.module.js";
import { HostKeyScanner } from "./host-key-scanner.js";
import { hostKeyOf, type HostKey } from "./host-keys.js";
import { OfficeIdentityHttpModule } from "./office-identity-http.module.js";
import { OfficeKnownHosts } from "./office-known-hosts.js";

const HOST_KEY = hostKeyOf(
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIazEu89wgQZ4bqs3d63QSEzYVa0MuJ2e2gKTKqu+UUO",
) as HostKey;

class FakeScanner extends HostKeyScanner {
  scan(): Promise<readonly HostKey[]> {
    return Promise.resolve([HOST_KEY]);
  }
}

describe("the Office identity's routes", { timeout: 30_000 }, () => {
  let officeData: string;
  let app: INestApplication;
  let url: string;

  beforeEach(async () => {
    officeData = await mkdtemp(join(tmpdir(), "office-identity-routes-"));
    const started = await startTestApplication({
      imports: [OfficeDataModule.forRoot(officeData), OfficeIdentityHttpModule],
      overrides: [{ provide: HostKeyScanner, useValue: new FakeScanner() }],
    });
    app = started.app;
    url = `${started.url}/api/office-identity`;
  });

  afterEach(async () => {
    await app.close();
    await rm(officeData, { recursive: true, force: true });
  });

  function post(path: string, body: unknown): Promise<Response> {
    return fetch(`${url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function knownHosts(): Promise<KnownHosts> {
    return knownHostsSchema.parse(await (await fetch(`${url}/known-hosts`)).json());
  }

  it("shows the Office ssh key's public half, made once", async () => {
    const first = officeSshKeySchema.parse(await (await fetch(`${url}/ssh-key`)).json());
    const second = officeSshKeySchema.parse(await (await fetch(`${url}/ssh-key`)).json());

    expect(first.publicKey).toMatch(/^ssh-ed25519 \S+ the-office@/);
    expect(second).toEqual(first);
  });

  it("scans an Unconfirmed host and trusts the key whose fingerprint the user confirms", async () => {
    await app.get(OfficeKnownHosts).addUnconfirmed("git.example.com", 2222);
    expect(await knownHosts()).toEqual({
      trusted: [],
      unconfirmed: [{ host: "git.example.com", port: 2222 }],
    });

    const scanned = await post("/known-hosts/scan", { host: "git.example.com", port: 2222 });
    expect(scannedHostSchema.parse(await scanned.json())).toEqual({
      host: "git.example.com",
      port: 2222,
      keys: [{ type: "ssh-ed25519", fingerprint: HOST_KEY.fingerprint }],
    });
    const confirmed = await post("/known-hosts", {
      host: "git.example.com",
      port: 2222,
      fingerprint: HOST_KEY.fingerprint,
    });

    const trusted = {
      trusted: [
        {
          host: "git.example.com",
          port: 2222,
          fingerprints: [HOST_KEY.fingerprint],
          fromGitHub: false,
        },
      ],
      unconfirmed: [],
    };
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual(trusted);
    expect(await knownHosts()).toEqual(trusted);
  });
});
