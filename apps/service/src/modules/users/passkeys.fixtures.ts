import {
  passkeyCreationOptionsSchema,
  passkeySchema,
  type Passkey,
  type PasskeyCreationOptions,
} from "@the-office/contracts";
import { expect } from "vitest";
import { SoftwareAuthenticator } from "./adapters/webauthn/software-authenticator.fixtures.js";
import { A_PASSWORD } from "./index.fixtures.js";
import { PUBLIC_ADDRESS, send, setCookieOf, type Answer } from "./users-application.fixtures.js";

/** A page's address as a browser addresses requests from it: its Host, Origin and proxy headers. */
export interface PageAt {
  readonly host: string;
  readonly origin: string;
  readonly headers: Readonly<Record<string, string>>;
}

export function atLocalhost(port: number): PageAt {
  const origin = `http://localhost:${port}`;
  return { host: `localhost:${port}`, origin, headers: { origin } };
}

export function atLoopbackIp(port: number): PageAt {
  const origin = `http://127.0.0.1:${port}`;
  return { host: `127.0.0.1:${port}`, origin, headers: { origin } };
}

/** The public address, through its reverse proxy over HTTPS unless `secure` is false. */
export function atPublicAddress({ secure = true }: { secure?: boolean } = {}): PageAt {
  return {
    host: new URL(PUBLIC_ADDRESS).host,
    origin: PUBLIC_ADDRESS,
    headers: secure ? { origin: PUBLIC_ADDRESS, "x-forwarded-proto": "https" } : {},
  };
}

/** A request from a page at `page`, with the cookie when given. */
export function sendFrom(
  port: number,
  page: PageAt,
  request: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    path: string;
    cookie?: string;
    body?: unknown;
  },
): Promise<Answer> {
  return send(port, {
    method: request.method ?? "GET",
    path: request.path,
    host: page.host,
    headers: { ...page.headers, ...(request.cookie !== undefined && { cookie: request.cookie }) },
    body: request.body,
  });
}

/** The user signed in with their password at `page`, on a new signed-in device of theirs. */
export async function signedInAt(
  port: number,
  page: PageAt,
  { email, password }: { email: string; password: string },
): Promise<string> {
  const answer = await sendFrom(port, page, {
    method: "POST",
    path: "/api/sign-in/password",
    body: { email, password },
  });
  expect(answer.status).toBe(200);
  return setCookieOf(answer).cookie;
}

/** Options for adding a passkey, after the current password. */
export async function addingOptions(
  port: number,
  page: PageAt,
  cookie: string,
  currentPassword = A_PASSWORD,
): Promise<PasskeyCreationOptions> {
  const answer = await sendFrom(port, page, {
    method: "POST",
    path: "/api/account/passkeys/options",
    cookie,
    body: { currentPassword },
  });
  expect(answer.status).toBe(200);
  return passkeyCreationOptionsSchema.parse(answer.body);
}

/** Adds a passkey the authenticator makes at `page`, named `name`. */
export async function addPasskey(
  port: number,
  page: PageAt,
  cookie: string,
  authenticator: SoftwareAuthenticator,
  name = "Laptop",
): Promise<Passkey> {
  const options = await addingOptions(port, page, cookie);
  const answer = await sendFrom(port, page, {
    method: "POST",
    path: "/api/account/passkeys",
    cookie,
    body: { name, registration: authenticator.register(options, page.origin) },
  });
  expect(answer.status).toBe(201);
  return passkeySchema.parse(answer.body);
}

export { SoftwareAuthenticator };
