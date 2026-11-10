import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { knownHostsSchema, officeSshKeySchema, type KnownHosts } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../test/test-application.js";
import { OfficeDataModule } from "../office-data/office-data.module.js";
import { HostKeyScanner } from "./host-key-scanner.js";
import { hostKeyOf, type HostKey } from "./host-keys.js";
import { OfficeIdentityHttpModule } from "./office-identity-http.module.js";

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

  it("regenerates the Office ssh key and answers its new public half, never its private one", async () => {
    const before = officeSshKeySchema.parse(await (await fetch(`${url}/ssh-key`)).json());

    const regenerated = await post("/ssh-key/regenerate", {});
    const text = await regenerated.text();
    const after = officeSshKeySchema.parse(await (await fetch(`${url}/ssh-key`)).json());

    expect(regenerated.status).toBe(200);
    expect(JSON.parse(text)).toEqual(after);
    expect(after.publicKey).toMatch(/^ssh-ed25519 \S+ the-office@/);
    expect(after.publicKey).not.toBe(before.publicKey);
    expect(text).not.toContain("PRIVATE KEY");
  });

  it("refuses a fingerprint the host doesn't show", async () => {
    const confirmed = await post("/known-hosts", {
      host: "git.example.com",
      fingerprint: "SHA256:not-the-host-key",
    });

    expect(confirmed.status).toBe(422);
    expect(await knownHosts()).toEqual({ trusted: [], unconfirmed: [] });
  });

  it("refuses a host that ssh's programs would read as an option", async () => {
    const scanned = await post("/known-hosts/scan", { host: "-oProxyCommand=calc", port: 22 });

    expect(scanned.status).toBe(400);
  });
});
