import { identityAuthorizationSchema } from "@the-office/contracts";
import { expect } from "vitest";
import { FakeIdentityProvider } from "./adapters/fake/fake-identity-provider.fixtures.js";
import { IDENTITY_TRIP_COOKIE } from "./adapters/http/identity-trip-cookie.js";
import { sendFrom, type PageAt } from "./passkeys.fixtures.js";
import {
  send,
  startUsersApplication,
  type Answer,
  type UsersApplication,
  type UsersApplicationOptions,
} from "./users-application.fixtures.js";

export interface OfficeWithProvider extends UsersApplication {
  readonly provider: FakeIdentityProvider;
}

/** The users module with `FakeIdentityProvider` bound as GitHub. */
export async function startWithFakeProvider(
  options: Omit<UsersApplicationOptions, "identityProviders"> = {},
): Promise<OfficeWithProvider> {
  const office = await startUsersApplication({
    ...options,
    identityProviders: { imports: [], identityProviders: [FakeIdentityProvider] },
  });
  return { ...office, provider: office.app.get(FakeIdentityProvider) };
}

/** The value of the cookie named `name` an answer set, or undefined when it set none. */
export function cookieNamed(answer: Answer, name: string): string | undefined {
  const set = (answer.headers["set-cookie"] ?? []).find((cookie) => cookie.startsWith(`${name}=`));
  return set?.split(";")[0]?.slice(name.length + 1);
}

/** The state an authorize URL carries to the provider. */
export function stateOf(authorizeUrl: string): string {
  return new URL(authorizeUrl).searchParams.get("state") ?? "";
}

/** A browser at `page` back from the provider at the callback, carrying `cookie` when given. */
export function backFromProvider(
  port: number,
  page: PageAt,
  query: Readonly<Record<string, string>>,
  cookie?: string,
): Promise<Answer> {
  return send(port, {
    path: `/api/sign-in/github/callback?${new URLSearchParams(query)}`,
    host: page.host,
    headers: cookie === undefined ? {} : { cookie },
  });
}

/** Starts linking from the account at `page`; answers the authorize URL. */
export async function startLinking(port: number, page: PageAt, cookie: string): Promise<string> {
  const answer = await sendFrom(port, page, {
    method: "POST",
    path: "/api/account/linked-identities/github",
    cookie,
  });
  expect(answer.status).toBe(200);
  return identityAuthorizationSchema.parse(answer.body).authorizeUrl;
}

/** Links whoever is signed in at the provider to the user signed in by `cookie`. */
export async function linkAt(
  office: OfficeWithProvider,
  page: PageAt,
  cookie: string,
): Promise<Answer> {
  const state = stateOf(await startLinking(office.port, page, cookie));
  return backFromProvider(
    office.port,
    page,
    { state, code: office.provider.codeOf(state) },
    cookie,
  );
}

/** Starts Continue with GitHub on the sign-in page at `page`: the authorize URL and the trip cookie. */
export async function startSignIn(
  port: number,
  page: PageAt,
  returnTo?: string,
): Promise<{ readonly authorizeUrl: string; readonly tripCookie: string }> {
  const answer = await sendFrom(port, page, {
    method: "POST",
    path: "/api/sign-in/github",
    body: returnTo === undefined ? {} : { returnTo },
  });
  expect(answer.status).toBe(200);
  const tripCookie = cookieNamed(answer, IDENTITY_TRIP_COOKIE);
  if (tripCookie === undefined) throw new Error("The start set no trip cookie.");
  return {
    authorizeUrl: identityAuthorizationSchema.parse(answer.body).authorizeUrl,
    tripCookie: `${IDENTITY_TRIP_COOKIE}=${tripCookie}`,
  };
}

/** Continue with GitHub from the sign-in page at `page`, as the provider's signed-in person. */
export async function continueAt(
  office: OfficeWithProvider,
  page: PageAt,
  returnTo?: string,
): Promise<Answer> {
  const { authorizeUrl, tripCookie } = await startSignIn(office.port, page, returnTo);
  const state = stateOf(authorizeUrl);
  return backFromProvider(
    office.port,
    page,
    { state, code: office.provider.codeOf(state) },
    tripCookie,
  );
}

/** Where an answer redirects, as a path with its query. */
export function locationOf(answer: Answer): URL {
  expect(answer.status).toBe(302);
  return new URL(String(answer.headers.location), "http://office.invalid");
}
