import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { openIdConnectProvider } from "./openid-connect-provider.schema.js";
import type { OpenIdConnectProvider } from "../../domain/openid-connect-provider.js";
import { OpenIdConnectProviderRepository } from "../../ports/openid-connect-provider-repository.js";
import { startUsersApplication, type UsersApplication } from "../../users-application.fixtures.js";

const NOW = new Date("2026-11-14T09:00:00.000Z");

const FIRST: OpenIdConnectProvider = {
  name: "Zitadel",
  issuer: "https://first.example.com",
  clientId: "first",
  clientSecret: "first-secret",
  authorizationEndpoint: "https://first.example.com/authorize",
  tokenEndpoint: "https://first.example.com/token",
  savedAt: NOW,
};

// The only test that writes `openid_connect_provider`, one row every test file's app would read.
let office: UsersApplication;
let repository: OpenIdConnectProviderRepository;

beforeEach(async () => {
  office = await startUsersApplication();
  repository = office.app.get(OpenIdConnectProviderRepository, { strict: false });
  await repository.remove(NOW);
});

afterEach(async () => {
  await repository.remove(NOW);
  await office.app.close();
});

describe("PostgresOpenIdConnectProviderRepository", () => {
  it("keeps one provider, replaced by the next saved, and forgets it", async () => {
    expect(await repository.find()).toBeUndefined();

    await repository.save(FIRST);
    expect(await repository.find()).toEqual(FIRST);
    const later = new Date(NOW.getTime() + 1000);
    const second = {
      ...FIRST,
      name: "Authentik",
      issuer: "https://second.example.com",
      clientId: "second",
      clientSecret: "second-secret",
      authorizationEndpoint: "https://second.example.com/authorize",
      tokenEndpoint: "https://second.example.com/token",
      savedAt: later,
    };
    await repository.save(second);

    expect(await repository.find()).toEqual(second);
    expect(await repository.remove(later)).toBe(true);
    expect(await repository.find()).toBeUndefined();
    expect(await repository.remove(later)).toBe(false);
  });

  it("keeps the last issuer through a removal, and forgets the secret", async () => {
    await repository.save(FIRST);
    expect(await repository.lastIssuer()).toBe(FIRST.issuer);

    await repository.remove(NOW);

    expect(await repository.lastIssuer()).toBe(FIRST.issuer);
    const [row] = await office.app
      .get<Database>(DATABASE, { strict: false })
      .select({ clientSecret: openIdConnectProvider.clientSecret })
      .from(openIdConnectProvider);
    expect(row?.clientSecret).toBe("");

    await repository.save(FIRST);
    expect(await repository.find()).toEqual(FIRST);
  });
});
