import {
  googleClientSchema,
  googleClientSettingSchema,
  identityCallbackUrlsSchema,
  signInPageSchema,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { SignInWays } from "../../application/sign-in-ways.js";
import { GoogleClientRemoved, GoogleClientSaved } from "../../domain/user-events.js";
import { addUser, type UserForTests } from "../../index.fixtures.js";
import {
  atLocalhost,
  atLoopbackIp,
  atPublicAddress,
  sendFrom,
  signedInAt,
  type PageAt,
} from "../../passkeys.fixtures.js";
import {
  googleClientForTests,
  InMemoryGoogleClientRepository,
} from "../../ports/google-client-repository.fixtures.js";
import { GoogleClientRepository } from "../../ports/google-client-repository.js";
import {
  PUBLIC_ADDRESS,
  startUsersApplication,
  type Answer,
  type UsersApplication,
} from "../../users-application.fixtures.js";
import { GoogleIdentityProvider } from "../google/google-identity-provider.js";

const CLIENT_ID = "1234-office.apps.googleusercontent.com";
const CLIENT_SECRET = "GOCSPX-the-client-secret";

let office: UsersApplication;
let clients: InMemoryGoogleClientRepository;
let me: UserForTests;
let localhost: PageAt;
let cookie: string;
let published: DomainEvent[];

beforeEach(async () => {
  office = await startUsersApplication({
    identityProviders: { imports: [], identityProviders: [GoogleIdentityProvider] },
    overrides: [googleClientForTests()],
  });
  clients = office.app.get(GoogleClientRepository);
  me = await addUser(office.app);
  localhost = atLocalhost(office.port);
  cookie = await signedInAt(office.port, localhost, me);
  published = [];
  office.app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await office.app.close();
});

function saveClient(body: { clientId: string; clientSecret: string }): Promise<Answer> {
  return sendFrom(office.port, localhost, {
    method: "PUT",
    path: "/api/settings/google-client",
    cookie,
    body,
  });
}

async function setting() {
  const answer = await sendFrom(office.port, localhost, {
    path: "/api/settings/google-client",
    cookie,
  });
  expect(answer.status).toBe(200);
  return answer;
}

async function waysAt(page: PageAt) {
  const answer = await sendFrom(office.port, page, { path: "/api/sign-in" });
  return signInPageSchema.parse(answer.body);
}

describe("/api/settings/google-client", () => {
  it("saves, changes and removes the client, never answering its secret", async () => {
    const answers: Answer[] = [];
    answers.push(await setting());
    expect(googleClientSettingSchema.parse(answers[0]?.body)).toEqual({ client: null });

    const saved = await saveClient({ clientId: ` ${CLIENT_ID} `, clientSecret: CLIENT_SECRET });
    answers.push(saved, await setting());
    expect(googleClientSchema.parse(saved.body)).toEqual({ clientId: CLIENT_ID, secretSet: true });
    expect(googleClientSettingSchema.parse(answers[2]?.body)).toEqual({
      client: { clientId: CLIENT_ID, secretSet: true },
    });

    // An empty secret keeps the saved one, so the client id changes without retyping it.
    const changed = await saveClient({
      clientId: "5678-office.apps.googleusercontent.com",
      clientSecret: "",
    });
    answers.push(changed);
    expect(changed.status).toBe(200);
    expect(clients.client).toEqual(
      expect.objectContaining({
        clientId: "5678-office.apps.googleusercontent.com",
        clientSecret: CLIENT_SECRET,
      }),
    );

    const removed = await sendFrom(office.port, localhost, {
      method: "DELETE",
      path: "/api/settings/google-client",
      cookie,
    });
    answers.push(removed, await setting());
    expect(removed.status).toBe(204);
    expect(googleClientSettingSchema.parse(answers.at(-1)?.body)).toEqual({ client: null });

    for (const answer of answers) {
      expect(JSON.stringify(answer.body ?? "")).not.toContain(CLIENT_SECRET);
      expect(JSON.stringify(answer.headers)).not.toContain(CLIENT_SECRET);
    }
    expect(published.filter((event) => event instanceof GoogleClientSaved)).toHaveLength(2);
    expect(published.filter((event) => event instanceof GoogleClientRemoved)).toEqual([
      expect.objectContaining({ userId: me.id }),
    ]);
    expect(JSON.stringify(published)).not.toContain(CLIENT_SECRET);
  });

  it("refuses a client without its id, or without a secret when none is saved", async () => {
    const answer = await saveClient({ clientId: " ", clientSecret: "" });

    expect(answer.status).toBe(422);
    expect(answer.body).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("Enter the client ID. Enter the client secret."),
      }),
    );
    expect(clients.client).toBeUndefined();
  });
});

describe("Continue with Google on the sign-in page", () => {
  it("is offered at localhost and the public address once a client is saved, and gone once it is removed", async () => {
    expect((await waysAt(localhost)).ways).not.toContainEqual({ kind: "google" });

    await saveClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });

    expect((await waysAt(localhost)).ways).toContainEqual({ kind: "google" });
    expect((await waysAt(atPublicAddress())).ways).toContainEqual({ kind: "google" });

    await sendFrom(office.port, localhost, {
      method: "DELETE",
      path: "/api/settings/google-client",
      cookie,
    });

    const page = await waysAt(localhost);
    expect(page.ways).not.toContainEqual({ kind: "google" });
    expect(page.unavailable).toEqual([]);
  });

  it("is never offered at a loopback or local network IP, nor at the public address over plain HTTP", async () => {
    await saveClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });

    const loopback = await waysAt(atLoopbackIp(office.port));
    const plainPublic = await waysAt(atPublicAddress({ secure: false }));
    const network = await office.app.get(SignInWays).at({
      kind: "local-network-ip",
      host: "192.168.1.20:4310",
      secure: false,
      publicAddress: PUBLIC_ADDRESS,
    });

    expect(loopback.ways).not.toContainEqual({ kind: "google" });
    expect(loopback.unavailable).toContainEqual({
      kind: "google",
      reason: "ip-address",
      elsewhere: `http://localhost:${office.port}`,
    });
    expect(plainPublic.ways).not.toContainEqual({ kind: "google" });
    expect(network.ways).not.toContainEqual(expect.objectContaining({ kind: "google" }));
    expect(network.unavailable).toContainEqual({
      kind: "google",
      reason: "needs-https-domain",
      elsewhere: PUBLIC_ADDRESS,
    });
  });
});

describe("/api/account/identity-callback-urls/google", () => {
  it("answers localhost's redirect URI and the public address's, and none for an IP address", async () => {
    const urlsAt = async (page: PageAt) => {
      const as = await signedInAt(office.port, page, me);
      const answer = await sendFrom(office.port, page, {
        path: "/api/account/identity-callback-urls/google",
        cookie: as,
      });
      return identityCallbackUrlsSchema.parse(answer.body);
    };

    expect(await urlsAt(localhost)).toEqual({
      thisAddress: `http://localhost:${office.port}/api/sign-in/google/callback`,
      publicAddress: `${PUBLIC_ADDRESS}/api/sign-in/google/callback`,
    });
    expect(await urlsAt(atLoopbackIp(office.port))).toEqual({
      thisAddress: null,
      publicAddress: `${PUBLIC_ADDRESS}/api/sign-in/google/callback`,
    });
  });
});
