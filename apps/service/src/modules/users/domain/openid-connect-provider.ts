/**
 * The OpenID Connect provider Continue with <name> signs in through (spec §2.10), such as a
 * self-hosted Zitadel, Authentik or Keycloak: one per Office, entered in Settings › Signing in. The
 * issuer is the one its discovery document names, and its endpoints are read from that document as
 * it is saved. Its secret has to be sent to the token endpoint, so it is kept as entered, and never
 * sent to the web.
 */
export interface OpenIdConnectProvider {
  readonly name: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly savedAt: Date;
}

/** The provider as Settings › Signing in enters it: an empty secret keeps the one saved. */
export interface OpenIdConnectProviderEntry {
  readonly name: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

/** What the issuer's discovery document says: its own issuer, and where to authorize and get tokens. */
export interface DiscoveredProvider {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
}

export const NAME_MAX_LENGTH = 40;
const MAX_LENGTH = 512;

type Checked<T> = { readonly checked: T } | { readonly problems: readonly string[] };

/**
 * The entry to read the discovery document of, over the provider saved, or every problem in the
 * page's words. Each field is trimmed, as they are pasted from the provider's console, and the
 * issuer loses a trailing slash, which discovery appends its path to.
 */
export function openIdConnectEntryOf(
  entry: OpenIdConnectProviderEntry,
  saved: OpenIdConnectProvider | undefined,
): Checked<OpenIdConnectProviderEntry> {
  const name = entry.name.trim();
  const issuer = entry.issuer.trim().replace(/\/+$/, "");
  const clientId = entry.clientId.trim();
  const clientSecret = entry.clientSecret.trim() || (saved?.clientSecret ?? "");
  const problems = [
    ...nameProblems(name),
    ...issuerProblems(issuer),
    ...(clientId === "" ? ["Enter the client ID."] : []),
    ...(clientSecret === "" ? ["Enter the client secret."] : []),
    ...(clientId.length > MAX_LENGTH || clientSecret.length > MAX_LENGTH
      ? [`The client ID and secret are at most ${MAX_LENGTH} characters.`]
      : []),
  ];
  if (problems.length > 0) return { problems };
  return { checked: { name, issuer, clientId, clientSecret } };
}

/**
 * The provider to save from the checked entry and its discovery document, or why not: the document
 * must name the issuer entered (OpenID Connect Discovery 4.3), and its endpoints be secure too.
 */
export function openIdConnectProviderOf(
  entry: OpenIdConnectProviderEntry,
  discovered: DiscoveredProvider,
  savedAt: Date,
): Checked<OpenIdConnectProvider> {
  if (discovered.issuer.replace(/\/+$/, "") !== entry.issuer) {
    return {
      problems: [
        `The provider says its issuer is ${discovered.issuer}, not ${entry.issuer}: enter the issuer URL it names.`,
      ],
    };
  }
  const endpoints = [discovered.authorizationEndpoint, discovered.tokenEndpoint];
  if (!endpoints.every(isSecureEnough)) {
    return {
      problems: [
        "The provider's discovery document names an endpoint that isn't HTTPS, so it can't be used.",
      ],
    };
  }
  return { checked: { ...entry, ...discovered, savedAt } };
}

/**
 * Whether the provider is at another issuer than the one saved last, removed since or not: a `sub`
 * means something only at its own issuer, so the identities linked at the one before can't sign
 * in at this one.
 */
export function isAnotherIssuer(
  lastIssuer: string | undefined,
  provider: OpenIdConnectProvider,
): boolean {
  return lastIssuer !== undefined && lastIssuer !== provider.issuer;
}

function nameProblems(name: string): readonly string[] {
  if (name === "") return ["Enter the name Continue with shows, such as Zitadel."];
  if (name.length > NAME_MAX_LENGTH) return [`The name is at most ${NAME_MAX_LENGTH} characters.`];
  return [];
}

function issuerProblems(issuer: string): readonly string[] {
  if (issuer === "") return ["Enter the issuer URL."];
  if (issuer.length > MAX_LENGTH) return [`The issuer URL is at most ${MAX_LENGTH} characters.`];
  const url = urlOf(issuer);
  if (url === undefined) return ["The issuer URL isn't a web address."];
  if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
    return ["The issuer URL can't have a query, a fragment or a user name."];
  }
  if (!isSecureEnough(issuer)) {
    return [
      "The issuer URL must start with https://, or http://localhost for a provider on this machine.",
    ];
  }
  return [];
}

/** The hosts plain HTTP is allowed to: a provider on the same machine. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** HTTPS, or plain HTTP to this machine only, where nothing crosses a network. */
export function isSecureEnough(address: string): boolean {
  const url = urlOf(address);
  if (url === undefined) return false;
  return (
    url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
  );
}

function urlOf(address: string): URL | undefined {
  try {
    return new URL(address);
  } catch {
    return undefined;
  }
}
