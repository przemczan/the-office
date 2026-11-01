import { API_PATH } from "@the-office/contracts";
import type { Request } from "express";
import type { ManifestReturnUrls } from "../../domain/github-app.js";

/** The routes GitHub sends the browser back to, under `/api`. */
export const RETURN_PATHS = {
  registered: "github/app/registered",
  signedIn: "github/sign-in/callback",
} as const;

/**
 * The address the request reached The Office on, which is the Office's own origin whatever
 * address the service listens on.
 */
export function officeOriginOf(request: Request): string {
  return `${request.protocol}://${request.host}`;
}

/** Where GitHub sends the browser back to, on the Office's origin. */
export function returnUrlsOf(officeOrigin: string): ManifestReturnUrls {
  return {
    registered: `${officeOrigin}${API_PATH}/${RETURN_PATHS.registered}`,
    signedIn: `${officeOrigin}${API_PATH}/${RETURN_PATHS.signedIn}`,
  };
}
