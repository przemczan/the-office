import { API_PATH, identityCallbackPath } from "@the-office/contracts";
import type { Request } from "express";
import type { OfficeAddresses } from "../../../../platform/http/office-addresses.js";
import type { ManifestReturnUrls } from "../../domain/github-app.js";

/** The routes GitHub sends the browser back to, under `/api`. */
export const RETURN_PATHS = {
  registered: "github/app/registered",
  signedIn: "github/sign-in/callback",
} as const;

/**
 * The address the request reached The Office on, which is the Office's own origin whatever
 * address the service listens on. At the public address it is the one configured: behind the
 * reverse proxy every request looks like plain HTTP.
 */
export function officeOriginOf(request: Request, addresses: OfficeAddresses): string {
  const { publicAddress } = addresses;
  if (publicAddress !== undefined && addresses.addressOf(request).kind === "public") {
    return publicAddress;
  }
  return `${request.protocol}://${request.host}`;
}

/**
 * Where GitHub sends the browser back to, on the Office's origin; Continue with GitHub's also on
 * the public address, when The Office has one.
 */
export function returnUrlsOf(officeOrigin: string, publicAddress?: string): ManifestReturnUrls {
  const identityOrigins = [officeOrigin, ...(publicAddress === undefined ? [] : [publicAddress])];
  return {
    registered: `${officeOrigin}${API_PATH}/${RETURN_PATHS.registered}`,
    signedIn: `${officeOrigin}${API_PATH}/${RETURN_PATHS.signedIn}`,
    identitySignedIn: [...new Set(identityOrigins)].map(
      (origin) => `${origin}${identityCallbackPath("github")}`,
    ),
  };
}
