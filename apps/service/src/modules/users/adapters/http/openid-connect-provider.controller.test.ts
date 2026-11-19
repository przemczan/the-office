import {
  identityCallbackUrlsSchema,
  openIdConnectProviderSchema,
  openIdConnectProviderSettingSchema,
  signInPageSchema,
  type SignInPage,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import type { IdentityProviderId, LinkedIdentity } from "../../domain/linked-identity.js";
import {
  OpenIdConnectProviderRemoved,
  OpenIdConnectProviderSaved,
} from "../../domain/user-events.js";
import { addUser, type UserForTests } from "../../index.fixtures.js";
import {
  atLocalhost,
  atLoopbackIp,
  atPublicAddress,
  sendFrom,
  signedInAt,
  type PageAt,
} from "../../passkeys.fixtures.js";
import { LinkedIdentityRepository } from "../../ports/linked-identity-repository.js";
import {
  FakeOpenIdConnectDiscovery,
  openIdConnectDiscoveryForTests,
} from "../../ports/openid-connect-discovery.fixtures.js";
import {
  OpenIdConnectDiscovery,
  OpenIdConnectDiscoveryFailed,
} from "../../ports/openid-connect-discovery.js";
import {
  InMemoryOpenIdConnectProviderRepository,
  openIdConnectProviderForTests,
} from "../../ports/openid-connect-provider-repository.fixtures.js";
import { OpenIdConnectProviderRepository } from "../../ports/openid-connect-provider-repository.js";
import {
  PUBLIC_ADDRESS,
  startUsersApplication,
  type Answer,
  type UsersApplication,
} from "../../users-application.fixtures.js";
import { OpenIdConnectIdentityProvider } from "../openid-connect/openid-connect-identity-provider.js";

const ISSUER = "https://login.example.com";
const CLIENT_ID = "office-client-id";
const CLIENT_SECRET = "the-very-secret-client-secret";

/**
 * The linked identities kept in memory: `removeAllAt` forgets every user's of a provider, which on
 * the table every test file shares would unlink another file's identities mid-test.
 */
class InMemoryLinkedIdentityRepository extends LinkedIdentityRepository {
  readonly identities: LinkedIdentity[] = [];

  listOf(userId: string): Promise<readonly LinkedIdentity[]> {
    return Promise.resolve(this.identities.filter((identity) => identity.userId === userId));
  }

  findBySubject(
    provider: IdentityProviderId,
    subject: string,
  ): Promise<LinkedIdentity | undefined> {
    return Promise.resolve(
      this.identities.find((one) => one.provider === provider && one.subject === subject),
    );
  }

  add(identity: LinkedIdentity): Promise<boolean> {
    this.identities.push(identity);
    return Promise.resolve(true);
  }

  save(): Promise<void> {
    return Promise.resolve();
  }

  remove(userId: string, provider: IdentityProviderId): Promise<boolean> {
    return Promise.resolve(
      this.drop((one) => one.userId === userId && one.provider === provider) > 0,
    );
  }

  removeAllOf(userId: string): Promise<void> {
    this.drop((one) => one.userId === userId);
    return Promise.resolve();
  }

  removeAllAt(provider: IdentityProviderId): Promise<number> {
    return Promise.resolve(this.drop((one) => one.provider === provider));
  }

  private drop(matches: (identity: LinkedIdentity) => boolean): number {
    const kept = this.identities.filter((identity) => !matches(identity));
    const dropped = this.identities.length - kept.length;
    this.identities.splice(0, this.identities.length, ...kept);
    return dropped;
  }
}

let office: UsersApplication;
let providers: InMemoryOpenIdConnectProviderRepository;
let discovery: FakeOpenIdConnectDiscovery;
let linked: InMemoryLinkedIdentityRepository;
let me: UserForTests;
let localhost: PageAt;
let cookie: string;
let published: DomainEvent[];

beforeEach(async () => {
  linked = new InMemoryLinkedIdentityRepository();
  office = await startUsersApplication({
    identityProviders: { imports: [], identityProviders: [OpenIdConnectIdentityProvider] },
    overrides: [
      openIdConnectProviderForTests(),
      openIdConnectDiscoveryForTests(),
      { provide: LinkedIdentityRepository, useValue: linked },
    ],
  });
  providers = office.app.get(
    OpenIdConnectProviderRepository,
  ) as InMemoryOpenIdConnectProviderRepository;
  discovery = office.app.get(OpenIdConnectDiscovery) as FakeOpenIdConnectDiscovery;
  me = await addUser(office.app);
  localhost = atLocalhost(office.port);
  cookie = await signedInAt(office.port, localhost, me);
  published = [];
  office.app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await office.app.close();
});

interface Entry {
  name?: string;
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
}

function save(entry: Entry = {}): Promise<Answer> {
  return sendFrom(office.port, localhost, {
    method: "PUT",
    path: "/api/settings/openid-connect-provider",
    cookie,
    body: {
      name: "Zitadel",
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      ...entry,
    },
  });
}

function remove(): Promise<Answer> {
  return sendFrom(office.port, localhost, {
    method: "DELETE",
    path: "/api/settings/openid-connect-provider",
    cookie,
  });
}

async function setting() {
  const answer = await sendFrom(office.port, localhost, {
    path: "/api/settings/openid-connect-provider",
    cookie,
  });
  expect(answer.status).toBe(200);
  return answer;
}

function linkIdentityAt(subject: string): void {
  linked.identities.push({
    id: subject,
    userId: me.id,
    provider: "openid-connect",
    subject,
    name: "ada@example.com",
    linkedAt: new Date(),
    lastSignedInAt: undefined,
  });
}

function messageOf(answer: Answer): string {
  return String((answer.body as { message?: unknown }).message);
}

describe("/api/settings/openid-connect-provider", () => {
  it("saves, changes and removes the provider, never answering its secret", async () => {
    const answers: Answer[] = [];
    answers.push(await setting());
    expect(openIdConnectProviderSettingSchema.parse(answers[0]?.body)).toEqual({ provider: null });

    const saved = await save({ name: " Zitadel ", issuer: ` ${ISSUER} ` });
    answers.push(saved, await setting());
    expect(openIdConnectProviderSchema.parse(saved.body)).toEqual({
      name: "Zitadel",
      issuer: ISSUER,
      clientId: CLIENT_ID,
      secretSet: true,
    });
    expect(openIdConnectProviderSettingSchema.parse(answers[2]?.body)).toEqual({
      provider: { name: "Zitadel", issuer: ISSUER, clientId: CLIENT_ID, secretSet: true },
    });
    expect(providers.provider).toEqual(
      expect.objectContaining({
        authorizationEndpoint: `${ISSUER}/oauth/v2/authorize`,
        tokenEndpoint: `${ISSUER}/oauth/v2/token`,
      }),
    );

    // An empty secret keeps the saved one, so the name changes without retyping it.
    const changed = await save({ name: "Company login", clientSecret: "" });
    answers.push(changed);
    expect(changed.status).toBe(200);
    expect(providers.provider).toEqual(
      expect.objectContaining({ name: "Company login", clientSecret: CLIENT_SECRET }),
    );

    const removed = await remove();
    answers.push(removed, await setting());
    expect(removed.status).toBe(204);
    expect(openIdConnectProviderSettingSchema.parse(answers.at(-1)?.body)).toEqual({
      provider: null,
    });

    for (const answer of answers) {
      expect(JSON.stringify(answer.body ?? "")).not.toContain(CLIENT_SECRET);
      expect(JSON.stringify(answer.headers)).not.toContain(CLIENT_SECRET);
    }
    expect(published.filter((event) => event instanceof OpenIdConnectProviderSaved)).toEqual([
      expect.objectContaining({
        userId: me.id,
        name: "Zitadel",
        issuer: ISSUER,
        clientId: CLIENT_ID,
      }),
      expect.objectContaining({ name: "Company login" }),
    ]);
    expect(published.filter((event) => event instanceof OpenIdConnectProviderRemoved)).toEqual([
      expect.objectContaining({ userId: me.id }),
    ]);
    expect(JSON.stringify(published)).not.toContain(CLIENT_SECRET);
  });

  it("refuses an entry without its fields, or without a secret when none is saved, saying every problem", async () => {
    const answer = await save({ name: " ", issuer: "", clientId: " ", clientSecret: "" });

    expect(answer.status).toBe(422);
    const message = messageOf(answer);
    for (const problem of [
      "Enter the name Continue with shows",
      "Enter the issuer URL.",
      "Enter the client ID.",
      "Enter the client secret.",
    ]) {
      expect(message).toContain(problem);
    }
    expect(providers.provider).toBeUndefined();
    expect(discovery.read).toEqual([]);
  });

  it("refuses a name over 40 characters, and an issuer that isn't HTTPS unless it is on this machine", async () => {
    const longName = await save({ name: "N".repeat(41) });
    const plain = await save({ issuer: "http://example.com" });
    const local = await save({ issuer: "http://localhost:8080" });

    expect(longName.status).toBe(422);
    expect(messageOf(longName)).toContain("The name is at most 40 characters.");
    expect(plain.status).toBe(422);
    expect(messageOf(plain)).toContain("must start with https://");
    expect(local.status).toBe(200);
    expect(discovery.read).toEqual(["http://localhost:8080"]);
  });

  it("accepts the issuer with a trailing slash, keeping it without", async () => {
    const answer = await save({ issuer: `${ISSUER}/` });

    expect(answer.status).toBe(200);
    expect(openIdConnectProviderSchema.parse(answer.body).issuer).toBe(ISSUER);
    expect(discovery.read).toEqual([ISSUER]);
  });

  it("refuses an issuer whose discovery fails, with the reason, saving nothing", async () => {
    discovery.answer(
      ISSUER,
      new OpenIdConnectDiscoveryFailed("login.example.com answered HTTP 404."),
    );

    const answer = await save();

    expect(answer.status).toBe(422);
    expect(messageOf(answer)).toContain("login.example.com answered HTTP 404.");
    expect(providers.provider).toBeUndefined();
    expect(published.filter((event) => event instanceof OpenIdConnectProviderSaved)).toEqual([]);
  });

  it("refuses a discovery document that names another issuer, or an endpoint that isn't HTTPS", async () => {
    discovery.answer(ISSUER, {
      issuer: "https://other.example.com",
      authorizationEndpoint: `${ISSUER}/authorize`,
      tokenEndpoint: `${ISSUER}/token`,
    });
    const another = await save();
    discovery.answer(ISSUER, {
      issuer: ISSUER,
      authorizationEndpoint: `${ISSUER}/authorize`,
      tokenEndpoint: "http://login.example.com/token",
    });
    const insecure = await save();

    expect(another.status).toBe(422);
    expect(messageOf(another)).toContain("says its issuer is https://other.example.com");
    expect(insecure.status).toBe(422);
    expect(messageOf(insecure)).toContain("isn't HTTPS");
    expect(providers.provider).toBeUndefined();
  });
});

describe("saving at another issuer", () => {
  it("unlinks the identities of the one before, as a sub means something only at its own issuer", async () => {
    await save();
    linkIdentityAt("sub-of-ada");

    await save({ issuer: "https://other.example.com" });

    expect(linked.identities).toEqual([]);
    expect(published.filter((event) => event instanceof OpenIdConnectProviderSaved)).toEqual([
      expect.objectContaining({ identitiesUnlinked: 0 }),
      expect.objectContaining({ identitiesUnlinked: 1 }),
    ]);
  });

  it("keeps them when the same issuer is saved again, even with another name or client", async () => {
    await save();
    linkIdentityAt("sub-of-ada");

    await save({ name: "Company login", clientId: "another-client", clientSecret: "another" });
    await save({ issuer: `${ISSUER}/` });

    expect(linked.identities).toHaveLength(1);
  });

  it("keeps them when the provider is removed, and links of other providers when the issuer changes", async () => {
    await save();
    linkIdentityAt("sub-of-ada");
    linked.identities.push({ ...linked.identities[0]!, id: "g", provider: "google", subject: "g" });

    await remove();
    expect(linked.identities).toHaveLength(2);

    await save();
    expect(linked.identities).toHaveLength(2);

    await save({ issuer: "https://other.example.com" });
    expect(linked.identities.map((identity) => identity.provider)).toEqual(["google"]);
  });

  it("unlinks them when a provider at another issuer is saved after the one before was removed", async () => {
    await save();
    linkIdentityAt("sub-of-ada");
    await remove();

    await save({ issuer: "https://other.example.com" });

    expect(linked.identities).toEqual([]);
  });
});

describe("Continue with the OpenID Connect provider on the sign-in page", () => {
  it("is offered under its name once saved, at every address, and gone once removed", async () => {
    expect((await waysAt(localhost)).ways).not.toContainEqual(
      expect.objectContaining({ kind: "openid-connect" }),
    );

    await save({ name: "Company login" });

    for (const page of [localhost, atLoopbackIp(office.port), atPublicAddress()]) {
      expect((await waysAt(page)).ways).toContainEqual({
        kind: "openid-connect",
        name: "Company login",
      });
    }

    await remove();

    const page = await waysAt(localhost);
    expect(page.ways).not.toContainEqual(expect.objectContaining({ kind: "openid-connect" }));
    expect(page.unavailable).toEqual([]);
  });

  it("sends the browser to the saved authorization endpoint, with this address's callback", async () => {
    await save();

    const answer = await sendFrom(office.port, atLoopbackIp(office.port), {
      method: "POST",
      path: "/api/sign-in/openid-connect",
      body: {},
    });

    expect(answer.status).toBe(200);
    const url = new URL((answer.body as { authorizeUrl: string }).authorizeUrl);
    expect(url.origin + url.pathname).toBe(`${ISSUER}/oauth/v2/authorize`);
    expect(url.searchParams.get("redirect_uri")).toBe(
      `http://127.0.0.1:${office.port}/api/sign-in/openid-connect/callback`,
    );
  });
});

describe("/api/account/identity-callback-urls/openid-connect", () => {
  it("answers this address's callback URL, at an IP address too, and the public address's", async () => {
    const urlsAt = async (page: PageAt) => {
      const as = await signedInAt(office.port, page, me);
      const answer = await sendFrom(office.port, page, {
        path: "/api/account/identity-callback-urls/openid-connect",
        cookie: as,
      });
      return identityCallbackUrlsSchema.parse(answer.body);
    };

    expect(await urlsAt(localhost)).toEqual({
      thisAddress: `http://localhost:${office.port}/api/sign-in/openid-connect/callback`,
      publicAddress: `${PUBLIC_ADDRESS}/api/sign-in/openid-connect/callback`,
    });
    expect(await urlsAt(atLoopbackIp(office.port))).toEqual({
      thisAddress: `http://127.0.0.1:${office.port}/api/sign-in/openid-connect/callback`,
      publicAddress: `${PUBLIC_ADDRESS}/api/sign-in/openid-connect/callback`,
    });
  });
});

async function waysAt(page: PageAt): Promise<SignInPage> {
  return signInPageSchema.parse((await sendFrom(office.port, page, { path: "/api/sign-in" })).body);
}
