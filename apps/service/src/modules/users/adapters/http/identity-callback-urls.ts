import { identityCallbackPath, type IdentityCallbackUrls } from "@the-office/contracts";
import type { Request } from "express";
import type { IdentityProviderId } from "../../domain/linked-identity.js";
import type { PageAddress } from "../../domain/page-address.js";

/**
 * The origin of the page's address. At the public address it is the one configured, never the
 * request's: behind the reverse proxy every request looks like plain HTTP.
 */
export function pageOriginOf(page: PageAddress, request: Request): string {
  if (page.kind === "public" && page.publicAddress !== undefined) return page.publicAddress;
  return `${request.protocol}://${page.host}`;
}

/**
 * The callback URL the provider sends the browser back to from a page at this address, which the
 * provider must list.
 */
export function identityCallbackUrlOf(
  page: PageAddress,
  request: Request,
  provider: IdentityProviderId,
): string {
  return `${pageOriginOf(page, request)}${identityCallbackPath(provider)}`;
}

/** The callback URLs to list at the provider: this page's address's, and the public address's. */
export function identityCallbackUrlsOf(
  page: PageAddress,
  request: Request,
  provider: IdentityProviderId,
): IdentityCallbackUrls {
  const { publicAddress } = page;
  return {
    thisAddress: identityCallbackUrlOf(page, request, provider),
    publicAddress:
      publicAddress === undefined ? null : `${publicAddress}${identityCallbackPath(provider)}`,
  };
}
