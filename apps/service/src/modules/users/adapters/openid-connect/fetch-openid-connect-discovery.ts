import { Logger } from "@nestjs/common";
import type { DiscoveredProvider } from "../../domain/openid-connect-provider.js";
import {
  OpenIdConnectDiscovery,
  OpenIdConnectDiscoveryFailed,
} from "../../ports/openid-connect-discovery.js";

/** How long the issuer has to answer before saving is refused. */
export const DISCOVERY_TIMEOUT_MS = 10_000;

/** OpenID Connect Discovery 4: the document's path under the issuer. */
const DISCOVERY_PATH = "/.well-known/openid-configuration";

/**
 * Reads the discovery document with Node's `fetch`, giving up after `DISCOVERY_TIMEOUT_MS`, and
 * keeps only the issuer and the two endpoints the authorization code flow needs. Bound by a
 * factory, as its timeout is a plain number.
 */
export class FetchOpenIdConnectDiscovery extends OpenIdConnectDiscovery {
  private readonly logger = new Logger(FetchOpenIdConnectDiscovery.name);

  constructor(private readonly timeoutMs: number = DISCOVERY_TIMEOUT_MS) {
    super();
  }

  async discover(issuer: string): Promise<DiscoveredProvider> {
    const address = `${issuer}${DISCOVERY_PATH}`;
    const response = await this.fetched(address);
    if (!response.ok) {
      throw new OpenIdConnectDiscoveryFailed(
        `${address} answered HTTP ${response.status}: check the issuer URL.`,
      );
    }
    const document = documentOf(await response.json().catch(() => undefined));
    if (document === undefined) {
      throw new OpenIdConnectDiscoveryFailed(
        `${address} isn't an OpenID Connect discovery document: check the issuer URL.`,
      );
    }
    return document;
  }

  private async fetched(address: string): Promise<Response> {
    try {
      return await fetch(address, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (failure) {
      const timedOut = failure instanceof DOMException && failure.name === "TimeoutError";
      this.logger.warn(`The OpenID Connect discovery document at ${address} couldn't be read.`);
      throw new OpenIdConnectDiscoveryFailed(
        timedOut
          ? `${address} didn't answer within ${this.timeoutMs / 1000} seconds.`
          : `The Office couldn't reach ${address}: check the issuer URL, and that The Office's host can reach it.`,
      );
    }
  }
}

/** The fields the flow needs, each a string, the endpoints web addresses; undefined otherwise. */
function documentOf(body: unknown): DiscoveredProvider | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const fields = body as Record<string, unknown>;
  const issuer = fields["issuer"];
  const authorizationEndpoint = fields["authorization_endpoint"];
  const tokenEndpoint = fields["token_endpoint"];
  if (
    typeof issuer !== "string" ||
    !isWebAddress(authorizationEndpoint) ||
    !isWebAddress(tokenEndpoint)
  ) {
    return undefined;
  }
  return { issuer, authorizationEndpoint, tokenEndpoint };
}

function isWebAddress(value: unknown): value is string {
  return typeof value === "string" && URL.canParse(value);
}
